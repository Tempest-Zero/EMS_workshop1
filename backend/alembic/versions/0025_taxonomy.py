"""taxonomy: fault_code + action_code + completion tap-picker columns

Revision ID: 0025
Revises: 0024
Create Date: 2026-07-08 00:00:01.000000

W5 (spec §3.4 taxonomy). Two vocabulary tables (String-slug PKs — legible in
every analytics query, C1) plus nullable ``job_completion.fault_code_id`` /
``action_code_id`` (all-NULL new columns → provably clean → FKs validated in
this migration). Nullable forever: flag-never-block extends to data
completeness.

Seed provenance — a documented MAPPING of ``src/features/troubleshooting/data/
faultCodes.js``, not a copy. That file is error-code-shaped (display codes E1/
UE/OE… with meanings + recommended parts); this vocabulary is diagnosis-shaped.
The judgment applied:

- Each faultCodes.js *meaning* becomes a category-scoped fault code
  (``ac-e1`` "indoor temp sensor fault" → ``ac_sensor_fault``); its implied
  *fix* becomes an action code ("Indoor temp sensor (thermistor)" →
  ``ac_sensor_replace``). Display codes themselves are NOT ids — brands
  disagree on codes, diagnoses transfer.
- The four categories active in real data (ac, refrigerator, washing_machine,
  microwave) are padded to 8–15 codes from workshop domain knowledge;
  microwave has no faultCodes.js rows at all, so its list is entirely padded.
  The other five categories get 4–6 codes each. Every category ends in a
  ``*_other`` fault / ``*_misc_repair`` action so the picker never dead-ends.
- ``is_surge_related=true`` marks faults that are characteristically
  voltage-surge damage (burnt boards, blown fuses, failed capacitors/relays)
  — §4.6: surge codes are flagged members of the same vocabulary, not a
  parallel one. W9 tops this set up with ``ON CONFLICT DO NOTHING``; the full
  initial set ships HERE.
- ``icon`` stays NULL — the pickers fall back to the category icon; per-code
  icons are a UI decision, not a data one.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (id, category_id, label_en, label_ur, is_surge_related, sort)
_FAULT_CODES = [
    # ── ac (faultCodes.js E1/E4/E6/F0/P1 + pads) ──────────────────────────
    ("ac_sensor_fault", "ac", "Temperature sensor fault", "درجہ حرارت سینسر خراب", False, 1),
    ("ac_compressor_overload", "ac", "Compressor overload / short", "کمپریسر اوورلوڈ", False, 2),
    (
        "ac_comm_error",
        "ac",
        "Indoor–outdoor communication error",
        "اندرونی بیرونی رابطہ خرابی",
        False,
        3,
    ),
    ("ac_gas_low", "ac", "Refrigerant leak / low gas", "گیس لیک / کم گیس", False, 4),
    ("ac_high_pressure", "ac", "High pressure trip", "ہائی پریشر ٹرپ", False, 5),
    ("ac_no_cooling", "ac", "Not cooling", "ٹھنڈا نہیں کرتا", False, 6),
    ("ac_water_leak", "ac", "Water dripping indoors", "اندر پانی ٹپکتا ہے", False, 7),
    ("ac_fan_fault", "ac", "Fan not running / noisy", "پنکھا خراب / شور", False, 8),
    ("ac_pcb_burnt", "ac", "Control board burnt", "کنٹرول بورڈ جلا ہوا", True, 9),
    ("ac_capacitor_fail", "ac", "Capacitor failed", "کپیسیٹر خراب", True, 10),
    ("ac_voltage_damage", "ac", "Voltage surge damage", "وولٹیج سے نقصان", True, 11),
    ("ac_other", "ac", "Other fault", "دیگر خرابی", False, 12),
    # ── refrigerator (faultCodes.js fr-* + pads) ──────────────────────────
    (
        "ref_thermostat_fault",
        "refrigerator",
        "Thermostat not regulating",
        "تھرموسٹیٹ خراب",
        False,
        1,
    ),
    (
        "ref_compressor_start",
        "refrigerator",
        "Compressor clicking / not starting",
        "کمپریسر اسٹارٹ نہیں ہوتا",
        False,
        2,
    ),
    ("ref_fan_fault", "refrigerator", "Fan / airflow fault", "پنکھا / ہوا کی روانی خراب", False, 3),
    ("ref_no_cooling", "refrigerator", "Not cooling", "ٹھنڈا نہیں کرتا", False, 4),
    ("ref_gas_leak", "refrigerator", "Gas leak / undercharge", "گیس لیک / کم گیس", False, 5),
    ("ref_compressor_dead", "refrigerator", "Compressor dead", "کمپریسر مکمل خراب", False, 6),
    (
        "ref_frost_buildup",
        "refrigerator",
        "Frost buildup / defrost fault",
        "برف جمنا / ڈی فراسٹ خراب",
        False,
        7,
    ),
    ("ref_door_seal", "refrigerator", "Door seal leaking", "دروازے کی ربڑ خراب", False, 8),
    ("ref_relay_burnt", "refrigerator", "Start relay burnt", "اسٹارٹ ریلے جلا ہوا", True, 9),
    ("ref_other", "refrigerator", "Other fault", "دیگر خرابی", False, 10),
    # ── washing_machine (faultCodes.js UE/OE/DE/LE/PE + pads) ─────────────
    (
        "wm_unbalanced",
        "washing_machine",
        "Unbalanced load / shaking",
        "لوڈ غیر متوازن / ہلتی ہے",
        False,
        1,
    ),
    ("wm_drain_fail", "washing_machine", "Not draining", "پانی نہیں نکلتا", False, 2),
    ("wm_door_lock", "washing_machine", "Door lock error", "ڈور لاک خراب", False, 3),
    ("wm_motor_fault", "washing_machine", "Motor / rotor error", "موٹر خراب", False, 4),
    (
        "wm_level_sensor",
        "washing_machine",
        "Water level sensor error",
        "واٹر لیول سینسر خراب",
        False,
        5,
    ),
    ("wm_no_spin", "washing_machine", "Drum not spinning", "ڈرم نہیں گھومتا", False, 6),
    ("wm_water_leak", "washing_machine", "Leaking water", "پانی لیک کرتی ہے", False, 7),
    ("wm_no_power", "washing_machine", "Dead / no power", "بجلی نہیں آتی", False, 8),
    ("wm_pcb_fault", "washing_machine", "Control board fault", "کنٹرول بورڈ خراب", True, 9),
    ("wm_other", "washing_machine", "Other fault", "دیگر خرابی", False, 10),
    # ── microwave (no faultCodes.js rows — fully padded; active in data) ──
    ("mw_no_heat", "microwave", "Not heating (magnetron)", "گرم نہیں کرتا", False, 1),
    ("mw_sparking", "microwave", "Sparking inside", "اندر چنگاریاں", False, 2),
    ("mw_turntable_stuck", "microwave", "Turntable not rotating", "پلیٹ نہیں گھومتی", False, 3),
    ("mw_door_switch", "microwave", "Door switch fault", "ڈور سوئچ خراب", False, 4),
    ("mw_keypad_fault", "microwave", "Keypad / panel fault", "کی پیڈ خراب", False, 5),
    ("mw_fuse_blown", "microwave", "Fuse blown", "فیوز اڑا ہوا", True, 6),
    ("mw_pcb_fault", "microwave", "Control board fault", "کنٹرول بورڈ خراب", True, 7),
    ("mw_other", "microwave", "Other fault", "دیگر خرابی", False, 8),
    # ── deep_freezer ──────────────────────────────────────────────────────
    ("df_no_cooling", "deep_freezer", "Not freezing", "ٹھنڈا نہیں کرتا", False, 1),
    (
        "df_compressor_start",
        "deep_freezer",
        "Compressor not starting",
        "کمپریسر اسٹارٹ نہیں ہوتا",
        False,
        2,
    ),
    ("df_gas_leak", "deep_freezer", "Gas leak / undercharge", "گیس لیک / کم گیس", False, 3),
    ("df_thermostat_fault", "deep_freezer", "Thermostat fault", "تھرموسٹیٹ خراب", False, 4),
    ("df_other", "deep_freezer", "Other fault", "دیگر خرابی", False, 5),
    # ── water_dispenser ───────────────────────────────────────────────────
    ("wd_no_cooling", "water_dispenser", "Not cooling", "ٹھنڈا نہیں کرتا", False, 1),
    ("wd_no_heating", "water_dispenser", "Not heating", "گرم نہیں کرتا", False, 2),
    ("wd_leak", "water_dispenser", "Leaking", "پانی لیک", False, 3),
    ("wd_tap_fault", "water_dispenser", "Tap / valve fault", "ٹونٹی / والو خراب", False, 4),
    ("wd_other", "water_dispenser", "Other fault", "دیگر خرابی", False, 5),
    # ── oven ──────────────────────────────────────────────────────────────
    ("ov_no_heat", "oven", "Not heating", "گرم نہیں کرتا", False, 1),
    ("ov_element_burnt", "oven", "Heating element burnt", "ایلیمنٹ جلا ہوا", False, 2),
    ("ov_thermostat_fault", "oven", "Thermostat fault", "تھرموسٹیٹ خراب", False, 3),
    ("ov_ignition_fault", "oven", "Ignition fault", "اگنیشن خراب", False, 4),
    ("ov_other", "oven", "Other fault", "دیگر خرابی", False, 5),
    # ── tv ────────────────────────────────────────────────────────────────
    ("tv_no_power", "tv", "Dead / no power", "آن نہیں ہوتا", False, 1),
    ("tv_no_display", "tv", "No picture", "تصویر نہیں آتی", False, 2),
    ("tv_backlight_fail", "tv", "Backlight failed", "بیک لائٹ خراب", False, 3),
    ("tv_board_fault", "tv", "Board fault", "بورڈ خراب", True, 4),
    ("tv_other", "tv", "Other fault", "دیگر خرابی", False, 5),
    # ── other ─────────────────────────────────────────────────────────────
    ("oth_electrical", "other", "Electrical fault", "برقی خرابی", False, 1),
    ("oth_mechanical", "other", "Mechanical fault", "مکینیکل خرابی", False, 2),
    ("oth_voltage_damage", "other", "Voltage surge damage", "وولٹیج سے نقصان", True, 3),
    ("oth_other", "other", "Other fault", "دیگر خرابی", False, 4),
]

# (id, category_id, label_en, label_ur, sort)
_ACTION_CODES = [
    # ── ac ────────────────────────────────────────────────────────────────
    ("ac_gas_recharge", "ac", "Gas recharge + leak repair", "گیس بھرائی و لیک مرمت", 1),
    ("ac_sensor_replace", "ac", "Replace temperature sensor", "سینسر تبدیل", 2),
    ("ac_capacitor_replace", "ac", "Replace capacitor", "کپیسیٹر تبدیل", 3),
    ("ac_pcb_repair", "ac", "Repair control board", "کنٹرول بورڈ مرمت", 4),
    ("ac_pcb_replace", "ac", "Replace control board", "کنٹرول بورڈ تبدیل", 5),
    ("ac_fan_motor_replace", "ac", "Replace fan motor", "پنکھے کی موٹر تبدیل", 6),
    ("ac_service_clean", "ac", "Full service / coil cleaning", "سروس و کوائل صفائی", 7),
    ("ac_wiring_repair", "ac", "Repair wiring", "وائرنگ مرمت", 8),
    ("ac_compressor_replace", "ac", "Replace compressor", "کمپریسر تبدیل", 9),
    ("ac_misc_repair", "ac", "Other repair", "دیگر مرمت", 10),
    # ── refrigerator ──────────────────────────────────────────────────────
    ("ref_relay_replace", "refrigerator", "Replace start relay + overload", "ریلے تبدیل", 1),
    ("ref_thermostat_replace", "refrigerator", "Replace thermostat", "تھرموسٹیٹ تبدیل", 2),
    ("ref_fan_replace", "refrigerator", "Replace fan motor", "پنکھے کی موٹر تبدیل", 3),
    ("ref_gas_recharge", "refrigerator", "Gas recharge + leak repair", "گیس بھرائی و لیک مرمت", 4),
    ("ref_compressor_replace", "refrigerator", "Replace compressor", "کمپریسر تبدیل", 5),
    ("ref_defrost_repair", "refrigerator", "Defrost system repair", "ڈی فراسٹ مرمت", 6),
    ("ref_door_seal_replace", "refrigerator", "Replace door gasket", "دروازے کی ربڑ تبدیل", 7),
    ("ref_misc_repair", "refrigerator", "Other repair", "دیگر مرمت", 8),
    # ── washing_machine ───────────────────────────────────────────────────
    (
        "wm_shock_absorber_replace",
        "washing_machine",
        "Replace shock absorbers",
        "شاک آبزرور تبدیل",
        1,
    ),
    ("wm_drain_pump_replace", "washing_machine", "Replace drain pump", "ڈرین پمپ تبدیل", 2),
    ("wm_drain_clean", "washing_machine", "Clear drain filter / hose", "ڈرین صفائی", 3),
    ("wm_door_lock_replace", "washing_machine", "Replace door lock", "ڈور لاک تبدیل", 4),
    ("wm_motor_repair", "washing_machine", "Repair / replace motor", "موٹر مرمت / تبدیل", 5),
    ("wm_sensor_replace", "washing_machine", "Replace level / hall sensor", "سینسر تبدیل", 6),
    ("wm_belt_replace", "washing_machine", "Replace belt", "بیلٹ تبدیل", 7),
    ("wm_pcb_repair", "washing_machine", "Repair control board", "کنٹرول بورڈ مرمت", 8),
    ("wm_misc_repair", "washing_machine", "Other repair", "دیگر مرمت", 9),
    # ── microwave ─────────────────────────────────────────────────────────
    ("mw_magnetron_replace", "microwave", "Replace magnetron", "میگنیٹرون تبدیل", 1),
    ("mw_fuse_replace", "microwave", "Replace fuse", "فیوز تبدیل", 2),
    ("mw_door_switch_replace", "microwave", "Replace door switch", "ڈور سوئچ تبدیل", 3),
    ("mw_capacitor_replace", "microwave", "Replace HV capacitor", "کپیسیٹر تبدیل", 4),
    ("mw_pcb_repair", "microwave", "Repair control board", "کنٹرول بورڈ مرمت", 5),
    ("mw_plate_motor_replace", "microwave", "Replace turntable motor", "پلیٹ موٹر تبدیل", 6),
    ("mw_misc_repair", "microwave", "Other repair", "دیگر مرمت", 7),
    # ── deep_freezer ──────────────────────────────────────────────────────
    ("df_gas_recharge", "deep_freezer", "Gas recharge + leak repair", "گیس بھرائی و لیک مرمت", 1),
    ("df_relay_replace", "deep_freezer", "Replace start relay", "ریلے تبدیل", 2),
    ("df_thermostat_replace", "deep_freezer", "Replace thermostat", "تھرموسٹیٹ تبدیل", 3),
    ("df_misc_repair", "deep_freezer", "Other repair", "دیگر مرمت", 4),
    # ── water_dispenser ───────────────────────────────────────────────────
    ("wd_cooling_repair", "water_dispenser", "Cooling system repair", "کولنگ مرمت", 1),
    ("wd_element_replace", "water_dispenser", "Replace heating element", "ایلیمنٹ تبدیل", 2),
    ("wd_tap_replace", "water_dispenser", "Replace tap / valve", "ٹونٹی تبدیل", 3),
    ("wd_misc_repair", "water_dispenser", "Other repair", "دیگر مرمت", 4),
    # ── oven ──────────────────────────────────────────────────────────────
    ("ov_element_replace", "oven", "Replace heating element", "ایلیمنٹ تبدیل", 1),
    ("ov_thermostat_replace", "oven", "Replace thermostat", "تھرموسٹیٹ تبدیل", 2),
    ("ov_ignition_repair", "oven", "Repair ignition", "اگنیشن مرمت", 3),
    ("ov_misc_repair", "oven", "Other repair", "دیگر مرمت", 4),
    # ── tv ────────────────────────────────────────────────────────────────
    ("tv_backlight_replace", "tv", "Replace backlight", "بیک لائٹ تبدیل", 1),
    ("tv_board_repair", "tv", "Repair board", "بورڈ مرمت", 2),
    ("tv_psu_repair", "tv", "Power supply repair", "پاور سپلائی مرمت", 3),
    ("tv_misc_repair", "tv", "Other repair", "دیگر مرمت", 4),
    # ── other ─────────────────────────────────────────────────────────────
    ("oth_electrical_repair", "other", "Electrical repair", "برقی مرمت", 1),
    ("oth_mechanical_repair", "other", "Mechanical repair", "مکینیکل مرمت", 2),
    ("oth_misc_repair", "other", "Other repair", "دیگر مرمت", 3),
]

_fault = sa.table(
    "fault_code",
    sa.column("id", sa.String),
    sa.column("category_id", sa.String),
    sa.column("label_en", sa.String),
    sa.column("label_ur", sa.String),
    sa.column("is_surge_related", sa.Boolean),
    sa.column("sort", sa.Integer),
)
_action = sa.table(
    "action_code",
    sa.column("id", sa.String),
    sa.column("category_id", sa.String),
    sa.column("label_en", sa.String),
    sa.column("label_ur", sa.String),
    sa.column("sort", sa.Integer),
)


def upgrade() -> None:
    op.create_table(
        "fault_code",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "category_id", sa.String(32), sa.ForeignKey("appliance_category.id"), nullable=False
        ),
        sa.Column("label_en", sa.String(128), nullable=True),
        sa.Column("label_ur", sa.String(128), nullable=True),
        sa.Column("icon", sa.String(64), nullable=True),
        sa.Column(
            "is_surge_related", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("sort", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_table(
        "action_code",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "category_id", sa.String(32), sa.ForeignKey("appliance_category.id"), nullable=False
        ),
        sa.Column("label_en", sa.String(128), nullable=True),
        sa.Column("label_ur", sa.String(128), nullable=True),
        sa.Column("icon", sa.String(64), nullable=True),
        sa.Column("sort", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )

    op.bulk_insert(
        _fault,
        [
            {
                "id": fid,
                "category_id": cat,
                "label_en": en,
                "label_ur": ur,
                "is_surge_related": surge,
                "sort": sort,
            }
            for fid, cat, en, ur, surge, sort in _FAULT_CODES
        ],
    )
    op.bulk_insert(
        _action,
        [
            {"id": aid, "category_id": cat, "label_en": en, "label_ur": ur, "sort": sort}
            for aid, cat, en, ur, sort in _ACTION_CODES
        ],
    )

    op.add_column("job_completion", sa.Column("fault_code_id", sa.String(64), nullable=True))
    op.add_column("job_completion", sa.Column("action_code_id", sa.String(64), nullable=True))
    op.create_foreign_key(
        "fk_job_completion_fault_code",
        "job_completion",
        "fault_code",
        ["fault_code_id"],
        ["id"],
        postgresql_not_valid=True,
    )
    op.execute("ALTER TABLE job_completion VALIDATE CONSTRAINT fk_job_completion_fault_code")
    op.create_foreign_key(
        "fk_job_completion_action_code",
        "job_completion",
        "action_code",
        ["action_code_id"],
        ["id"],
        postgresql_not_valid=True,
    )
    op.execute("ALTER TABLE job_completion VALIDATE CONSTRAINT fk_job_completion_action_code")


def downgrade() -> None:
    op.drop_constraint("fk_job_completion_action_code", "job_completion", type_="foreignkey")
    op.drop_constraint("fk_job_completion_fault_code", "job_completion", type_="foreignkey")
    op.drop_column("job_completion", "action_code_id")
    op.drop_column("job_completion", "fault_code_id")
    op.drop_table("action_code")
    op.drop_table("fault_code")
