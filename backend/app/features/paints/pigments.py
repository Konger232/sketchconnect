"""
Pigment codes for the paint library (design doc, item 46). A code is a
Colour Index generic name: P, a family, a number, sometimes a variant
("PB15:3"). KNOWN lists the pigments watercolour makers commonly use; a
code outside it is allowed only after the sketcher confirms it (it may be
real, or a typo). Source for checking: Art is Creation's Color Index names
(https://artiscreation.com/Color_index_names.html).
"""
import re

FAMILIES = {
    "Y": "yellow", "O": "orange", "R": "red", "V": "violet", "B": "blue",
    "G": "green", "Br": "brown", "Bk": "black", "W": "white",
}
CODE = re.compile(r"^P(Br|Bk|Y|O|R|V|B|G|W)(\d{1,3})(?::(\d))?$")

KNOWN = set("""
PY1 PY3 PY12 PY13 PY17 PY24 PY31 PY34 PY35 PY35:1 PY37 PY40 PY42 PY43 PY53 PY55 PY65 PY73 PY74 PY81 PY83
PY93 PY95 PY97 PY98 PY100 PY108 PY109 PY110 PY111 PY119 PY120 PY128 PY129 PY138 PY139 PY150 PY151 PY153
PY154 PY155 PY157 PY159 PY164 PY175 PY180 PY183 PY184 PY216
PO20 PO34 PO36 PO43 PO48 PO49 PO59 PO62 PO64 PO65 PO67 PO71 PO72 PO73
PR3 PR5 PR7 PR9 PR23 PR48 PR48:1 PR48:4 PR57 PR57:1 PR81 PR83 PR88 PR101 PR102 PR104 PR105 PR106 PR108 PR108:1
PR112 PR122 PR144 PR146 PR149 PR166 PR168 PR170 PR171 PR175 PR176 PR177 PR178 PR179 PR180 PR181 PR183
PR184 PR185 PR187 PR188 PR192 PR194 PR202 PR206 PR207 PR209 PR214 PR216 PR224 PR233 PR242 PR251 PR253
PR254 PR255 PR259 PR260 PR264 PR266 PR282
PV1 PV2 PV3 PV5 PV14 PV15 PV16 PV19 PV23 PV29 PV32 PV37 PV39 PV42 PV47 PV49 PV55
PB1 PB15 PB15:1 PB15:2 PB15:3 PB15:4 PB15:6 PB16 PB17 PB27 PB28 PB29 PB33 PB35 PB36 PB36:1 PB60 PB62
PB66 PB72 PB73 PB74 PB80
PG7 PG8 PG10 PG17 PG18 PG19 PG23 PG26 PG36 PG50
PBr6 PBr7 PBr8 PBr11 PBr23 PBr24 PBr25 PBr33 PBr39 PBr41
PBk1 PBk6 PBk7 PBk8 PBk9 PBk10 PBk11 PBk19 PBk26 PBk27 PBk28 PBk31 PBk32
PW4 PW5 PW6 PW7 PW18 PW21 PW22
""".split())


def normalize(code: str) -> str | None:
    """'pb 15:3' -> 'PB15:3'; None when it is not a pigment code at all."""
    s = re.sub(r"\s+", "", str(code or ""))
    if len(s) < 3 or s[0].upper() != "P":
        return None
    # The family letters: Br and Bk keep a lower-case second letter.
    rest = s[1:]
    for fam in ("Br", "Bk"):
        if rest[:2].lower() == fam.lower():
            s = "P" + fam + rest[2:]
            break
    else:
        s = "P" + rest[0].upper() + rest[1:]
    m = CODE.match(s)
    if not m:
        return None
    return f"P{m.group(1)}{int(m.group(2))}" + (f":{m.group(3)}" if m.group(3) else "")


def family(code: str) -> str | None:
    m = CODE.match(code or "")
    return FAMILIES[m.group(1)] if m else None
