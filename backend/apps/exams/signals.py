from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Exam, ExamSettings


@receiver(post_save, sender=Exam)
def create_exam_settings(sender, instance: Exam, created: bool, **kwargs) -> None:  # type: ignore[no-untyped-def]
    if created:
        ExamSettings.objects.get_or_create(exam=instance)
