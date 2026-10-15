"""Strict, bounded validation for user-supplied exam media.

Uploads are never served from STATIC_URL or MEDIA_URL. This module checks byte signatures rather than
trusting browser-supplied filenames/content types and returns a server-derived MIME type plus a digest.
"""
from __future__ import annotations

import hashlib
import os
import re
import unicodedata
from typing import Any


IMAGE_LIMIT = 5 * 1024 * 1024
AUDIO_LIMIT = 15 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000

# ISO-BMFF brands that mean "audio in an MP4 container". Read from bytes 8..12 of the `ftyp` box.
_MP4_AUDIO_BRANDS = frozenset({b"M4A ", b"M4B ", b"mp42", b"isom", b"iso2", b"M4V "})


def _safe_name(name: str) -> str:
    value = unicodedata.normalize("NFKC", os.path.basename((name or "").replace("\\", "/")))
    value = "".join(char for char in value if char.isprintable() and ord(char) >= 32)
    value = re.sub(r"[^\w. ()-]+", "_", value, flags=re.UNICODE).strip(" .")
    return (value or "upload")[:180]


def inspect_media_upload(upload: Any, kind: str) -> dict[str, Any]:
    """Validate a Django UploadedFile, reset it for storage, and return safe metadata."""
    if kind not in {"image", "audio"}:
        raise ValueError("نوع فایل پشتیبانی نمی‌شود.")
    size = int(getattr(upload, "size", 0) or 0)
    limit = IMAGE_LIMIT if kind == "image" else AUDIO_LIMIT
    if size <= 0:
        raise ValueError("فایل خالی است.")
    if size > limit:
        limit_mb = limit // (1024 * 1024)
        raise ValueError(f"حجم فایل نباید بیشتر از {limit_mb} مگابایت باشد.")

    try:
        header = upload.read(64)
        upload.seek(0)
    except (AttributeError, OSError) as exc:
        raise ValueError("خواندن فایل بارگذاری‌شده ممکن نیست.") from exc

    mime: str | None = None
    if kind == "image":
        if header.startswith(b"\xff\xd8\xff"):
            mime = "image/jpeg"
        elif header.startswith(b"\x89PNG\r\n\x1a\n"):
            mime = "image/png"
            if len(header) >= 24 and header[12:16] == b"IHDR":
                width = int.from_bytes(header[16:20], "big")
                height = int.from_bytes(header[20:24], "big")
                if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                    raise ValueError("ابعاد تصویر بیش از حد مجاز است.")
        elif header.startswith(b"RIFF") and header[8:12] == b"WEBP":
            mime = "image/webp"
        if mime is None:
            raise ValueError("فقط تصویرهای JPEG، PNG یا WebP مجاز هستند؛ SVG و فایل‌های اجرایی پذیرفته نمی‌شوند.")
    else:
        if header.startswith(b"ID3") or (len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE0 == 0xE0):
            mime = "audio/mpeg"
        elif header.startswith(b"OggS"):
            mime = "audio/ogg"
        elif header.startswith(b"RIFF") and header[8:12] == b"WAVE":
            mime = "audio/wav"
        elif header.startswith(b"\x1a\x45\xdf\xa3"):
            # WebM is accepted for browser MediaRecorder audio. The endpoint serves it as audio/webm only;
            # no uploaded HTML/SVG/script is ever rendered as a document.
            mime = "audio/webm"
        elif header[4:8] == b"ftyp" and header[8:12] in _MP4_AUDIO_BRANDS:
            # Safari's MediaRecorder has no WebM encoder and answers an in-page recording as MP4/AAC. Refusing
            # it would mean every iPad student silently cannot send a spoken answer. The brand is checked, not
            # just the box, so a renamed .mov or .mp4 video does not ride through on the same four bytes.
            mime = "audio/mp4"
        if mime is None:
            raise ValueError("فقط فایل صوتی MP3، OGG، WAV، WebM یا M4A مجاز است.")

    digest = hashlib.sha256()
    try:
        for chunk in upload.chunks():
            digest.update(chunk)
        upload.seek(0)
    except (AttributeError, OSError) as exc:
        raise ValueError("خواندن فایل بارگذاری‌شده ممکن نیست.") from exc

    return {
        "kind": kind,
        "original_name": _safe_name(getattr(upload, "name", "upload")),
        "content_type": mime,
        "size_bytes": size,
        "sha256": digest.hexdigest(),
    }
