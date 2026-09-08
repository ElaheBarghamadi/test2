from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import StudentProfile, TeacherProfile, User


@receiver(post_save, sender=User)
def create_role_profile(sender, instance: User, created: bool, **kwargs) -> None:  # type: ignore[no-untyped-def]
    """Provision the small role-specific profile only when its role needs one."""
    if instance.role == User.Role.STUDENT:
        StudentProfile.objects.get_or_create(user=instance)
    elif instance.role == User.Role.TEACHER:
        TeacherProfile.objects.get_or_create(user=instance)
