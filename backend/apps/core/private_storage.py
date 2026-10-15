"""A filesystem storage rooted in the configured private media directory.

The root is resolved from Django settings at runtime rather than captured in a generated migration, so a
portable migration never embeds a developer's absolute checkout path.
"""
from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils.deconstruct import deconstructible
from django.utils.functional import cached_property


@deconstructible
class PrivateMediaStorage(FileSystemStorage):
    """Private local storage with restrictive permissions and no public URL."""

    def __init__(self) -> None:
        # Keep the constructor argument-free so migrations serialize only the class, never a machine path.
        super().__init__(
            location=None,
            file_permissions_mode=0o640,
            directory_permissions_mode=0o750,
        )

    @cached_property
    def base_location(self) -> str:
        return str(Path(settings.PRIVATE_MEDIA_ROOT).expanduser().resolve())

    @cached_property
    def location(self) -> str:
        return self.base_location

    @cached_property
    def base_url(self) -> None:
        # An accidental `FieldFile.url` access must never manufacture a public URL.
        return None
