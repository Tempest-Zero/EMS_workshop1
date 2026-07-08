"""Pakistani phone-number normalization (pure kernel — no app imports).

One rule, two strictness levels, shared by every slice that touches a phone:

* ``to_e164_pk`` — strict: a recognizable Pakistani *mobile* → ``+923XXXXXXXXX``,
  anything else → ``None``. Used for matching (customers) and for WhatsApp
  addressing (click-to-chat and the Cloud API both want bare E.164).
* ``canonicalize_pk_phone`` — lenient: same conversion when it applies, but a
  landline, foreign, or annotated entry is kept trimmed as-is. Used at intake,
  where the phone field has always been free text and must never reject.
"""

from __future__ import annotations

import re

# The common Pakistani-mobile spellings ("0300-1234567", "+92 300 1234567",
# "3001234567") after punctuation is stripped. Group 1 is the bare mobile.
_PK_MOBILE = re.compile(r"^(?:\+?92|0092|0)?(3\d{9})$")


def to_e164_pk(raw: str | None) -> str | None:
    """Recognizable Pakistani mobiles → E.164 (``+923XXXXXXXXX``); else ``None``."""
    if not raw:
        return None
    digits = re.sub(r"[^\d+]", "", raw)
    m = _PK_MOBILE.match(digits)
    if m is None:
        return None
    return "+92" + m.group(1)


def canonicalize_pk_phone(raw: str | None) -> str | None:
    """Store recognizable Pakistani mobiles as E.164; keep everything else.

    Lenient by design: the intake phone field has always been free text, so a
    landline, foreign number, or annotated entry is returned trimmed unchanged
    — intake must never fail over the phone. Empty/whitespace → ``None``.

    Strips only punctuation (``0300-123 4567``), unlike ``to_e164_pk``'s
    everything-but-digits: an *annotated* entry ("0300-1234567 (father)") is a
    note, not a number — it must survive as typed, though it still *matches*
    a customer via the strict rule.
    """
    if raw is None:
        return None
    trimmed = raw.strip()
    cleaned = re.sub(r"[\s().-]", "", trimmed)
    m = _PK_MOBILE.match(cleaned)
    if m:
        return "+92" + m.group(1)
    return trimmed or None
