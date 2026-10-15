"""The upload boundary: what a browser can hand this API and what it refuses.

This is a security edge rather than a feature, so the tests are written against raw bytes. A filename or a
`Content-Type` header is a claim made by client code; the only thing that decides what is stored is the first
few bytes of the file itself.
"""
from __future__ import annotations

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase

from apps.core.secure_uploads import AUDIO_LIMIT, IMAGE_LIMIT, inspect_media_upload


def png_bytes() -> bytes:
    """A minimal, dimension-correct PNG header — enough for the signature and IHDR checks."""
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + (400).to_bytes(4, "big") + (300).to_bytes(4, "big") + b"\x08\x06\x00\x00\x00" + b"\x00" * 32


class InspectMediaUploadTests(SimpleTestCase):
    def test_accepts_the_three_image_containers(self) -> None:
        cases = {
            "image/jpeg": b"\xff\xd8\xff\xe0" + b"\x00" * 40,
            "image/png": png_bytes(),
            "image/webp": b"RIFF" + (2048).to_bytes(4, "little") + b"WEBPVP8 " + b"\x00" * 32,
        }
        for expected, payload in cases.items():
            with self.subTest(expected=expected):
                upload = SimpleUploadedFile("answer.bin", payload, content_type="application/octet-stream")
                metadata = inspect_media_upload(upload, "image")
                self.assertEqual(metadata["content_type"], expected)
                self.assertEqual(metadata["size_bytes"], len(payload))
                self.assertEqual(len(metadata["sha256"]), 64)

    def test_the_declared_content_type_never_decides_what_is_stored(self) -> None:
        # A JPEG claiming to be an SVG is still stored as a JPEG; the reverse is refused outright.
        upload = SimpleUploadedFile("x.svg", b"\xff\xd8\xff\xe0" + b"\x00" * 40, content_type="image/svg+xml")
        self.assertEqual(inspect_media_upload(upload, "image")["content_type"], "image/jpeg")

        spoofed = SimpleUploadedFile("photo.jpg", b"<svg onload=alert(1)></svg>", content_type="image/jpeg")
        with self.assertRaisesMessage(ValueError, "JPEG"):
            inspect_media_upload(spoofed, "image")

    def test_refuses_an_oversized_image_dimensions_bomb(self) -> None:
        header = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR"
        huge = header + (20000).to_bytes(4, "big") + (20000).to_bytes(4, "big") + b"\x08\x06\x00\x00\x00" + b"\x00" * 32
        upload = SimpleUploadedFile("big.png", huge)
        with self.assertRaisesMessage(ValueError, "ابعاد تصویر"):
            inspect_media_upload(upload, "image")

    def test_accepts_the_audio_containers_a_browser_can_produce(self) -> None:
        cases = {
            # Chrome and Firefox record WebM; the EBML magic is the same for both.
            "audio/webm": b"\x1a\x45\xdf\xa3" + b"\x00" * 40,
            "audio/mpeg": b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 40,
            "audio/ogg": b"OggS" + b"\x00" * 40,
            "audio/wav": b"RIFF" + (2048).to_bytes(4, "little") + b"WAVEfmt " + b"\x00" * 32,
            # Safari has no WebM encoder: an in-page recording there arrives as AAC in an MP4 container.
            "audio/mp4": b"\x00\x00\x00 ftypM4A " + b"\x00" * 40,
        }
        for expected, payload in cases.items():
            with self.subTest(expected=expected):
                upload = SimpleUploadedFile("voice.bin", payload, content_type="application/octet-stream")
                self.assertEqual(inspect_media_upload(upload, "audio")["content_type"], expected)

    def test_refuses_audio_that_is_not_a_known_container(self) -> None:
        upload = SimpleUploadedFile("voice.mp3", b"MZ\x90\x00" + b"\x00" * 40, content_type="audio/mpeg")
        with self.assertRaisesMessage(ValueError, "MP3"):
            inspect_media_upload(upload, "audio")

    def test_refuses_empty_and_oversized_files(self) -> None:
        with self.assertRaisesMessage(ValueError, "خالی"):
            inspect_media_upload(SimpleUploadedFile("empty.png", b""), "image")

        with self.assertRaisesMessage(ValueError, "حجم فایل"):
            inspect_media_upload(SimpleUploadedFile("big.png", b"\x00" * (IMAGE_LIMIT + 1)), "image")

        with self.assertRaisesMessage(ValueError, "حجم فایل"):
            inspect_media_upload(SimpleUploadedFile("big.webm", b"\x00" * (AUDIO_LIMIT + 1)), "audio")

    def test_refuses_an_unknown_kind(self) -> None:
        upload = SimpleUploadedFile("doc.pdf", b"%PDF-1.7" + b"\x00" * 40)
        with self.assertRaisesMessage(ValueError, "نوع فایل پشتیبانی نمی‌شود"):
            inspect_media_upload(upload, "document")

    def test_a_sanitised_original_name_survives_but_cannot_escape_its_directory(self) -> None:
        upload = SimpleUploadedFile("../../etc/passwd", b"\xff\xd8\xff\xe0" + b"\x00" * 40)
        name = inspect_media_upload(upload, "image")["original_name"]
        self.assertNotIn("/", name)
        self.assertNotIn("..", name)
