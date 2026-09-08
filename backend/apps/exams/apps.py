from django.apps import AppConfig


class ExamsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.exams"
    label = "exams"
    verbose_name = "Exams"

    def ready(self) -> None:
        from . import signals  # noqa: F401
