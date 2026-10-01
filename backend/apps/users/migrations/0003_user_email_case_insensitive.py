"""One address, one account — whatever the casing.

Two things happen here, in this order, because the second cannot succeed unless the first has run:

1. every stored address is rewritten in the canonical form (trimmed, lower-case);
2. a functional unique index on `LOWER(email)` is added, so the database itself refuses a second account
   that differs from an existing one only by case.

The rewrite is deliberately loud: if two rows turned out to be the same address in different casing, this
migration stops with the two ids and addresses named, rather than failing later with an index error the
operator has to decode.
"""

from django.db import migrations, models
from django.db.models.functions import Lower


def lowercase_emails(apps, schema_editor) -> None:  # type: ignore[no-untyped-def]
    User = apps.get_model("users", "User")
    seen: dict[str, object] = {}
    for user in User.objects.all().order_by("created_at"):
        canonical = (user.email or "").strip().lower()
        if canonical in seen:
            raise RuntimeError(
                "Two accounts share the same email address in different casing: "
                f"{seen[canonical]} and {user.pk} both read as {canonical}. "
                "Merge or rename one of them, then run this migration again."
            )
        seen[canonical] = user.pk
        if user.email != canonical:
            user.email = canonical
            user.save(update_fields=["email"])


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0002_alter_user_role"),
    ]

    operations = [
        migrations.RunPython(lowercase_emails, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(Lower("email"), name="users_user_email_case_insensitive"),
        ),
    ]
