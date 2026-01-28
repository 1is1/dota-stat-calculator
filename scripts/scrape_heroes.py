from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from lxml import html


# ---------------------------
# Text + parsing helpers
# ---------------------------

def _clean(s: Optional[str]) -> str:
    if not s:
        return ""
    s = s.replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _to_number_or_string(s: str) -> Any:
    s = _clean(s)
    if s == "":
        return None
    if re.fullmatch(r"-?\d+(\.\d+)?", s):
        return float(s) if "." in s else int(s)
    return s


def _first(xs: List[Any]) -> Optional[Any]:
    return xs[0] if xs else None


def _slugify(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


# ---------------------------
# Config
# ---------------------------

@dataclass(frozen=True)
class ScrapeConfig:
    source: str                 # URL or local file path
    thead_xpath: str            # XPath pointing to <thead>


# ---------------------------
# Loading HTML
# ---------------------------

def load_document(source: str) -> Tuple[Any, str]:
    """
    Loads HTML from either:
      - https://... or http://...
      - a local file path (relative or absolute)

    Returns: (lxml_document, resolved_source_string_for_metadata)
    """
    if source.startswith("http://") or source.startswith("https://"):
        headers = {
            # Some wiki sites are picky; this helps in many cases.
            "User-Agent": "Mozilla/5.0 (compatible; HeroScraper/1.0; +https://github.com/)"
        }
        r = requests.get(source, headers=headers, timeout=30)
        r.raise_for_status()
        return html.fromstring(r.content), source

    path = Path(source)
    if not path.exists():
        raise FileNotFoundError(f"Local HTML file not found: {path}")

    # Try utf-8 first; if it fails, fall back to a more forgiving read.
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        content = path.read_text(encoding="utf-8", errors="replace")

    # Use absolute path in metadata so you know what you scraped from.
    return html.fromstring(content), str(path.resolve())


# ---------------------------
# Parsing table
# ---------------------------

def parse_header_keys(thead) -> List[str]:
    """
    Returns header keys in order. Prefers <abbr> text, else TH text.
    Normalizes multi-line headers.
    """
    keys: List[str] = []
    ths = thead.xpath(".//th")

    for th in ths:
        abbr = _first(th.xpath(".//abbr"))
        if abbr is not None:
            key = _clean("".join(abbr.itertext()))
        else:
            key = _clean("".join(th.itertext()))

        key = re.sub(r"\s+", " ", key)

        # Fix DMG columns (often appear as "DMG" plus "(MIN)/(MAX)" text)
        th_text = _clean("".join(th.itertext()))
        if key == "DMG" and "(MIN)" in th_text:
            key = "DMG (MIN)"
        if key == "DMG" and "(MAX)" in th_text:
            key = "DMG (MAX)"

        keys.append(key)

    return keys


def parse_row_cells(tr) -> List[Dict[str, Any]]:
    """
    Extract TD cell list in order.
    Uses data-sort-value if available for 'value'.
    """
    out: List[Dict[str, Any]] = []
    for td in tr.xpath("./td"):
        sort_value = td.get("data-sort-value")
        text = _clean("".join(td.itertext()))

        # The first meaningful link text is usually the hero name in the HERO column
        a = _first(td.xpath(".//a[normalize-space(string(.))!='']"))
        link_text = _clean("".join(a.itertext())) if a is not None else None

        value_source = sort_value if sort_value is not None else text
        out.append(
            {
                "text": text,
                "value": _to_number_or_string(value_source),
                "sort_value": sort_value,
                "link_text": link_text,
            }
        )
    return out


def to_semantic_hero(header_keys: List[str], cells: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Converts one parsed row to a stable hero schema for your web app.
    Also includes 'raw' mapping so you don't lose information.
    """
    if len(header_keys) != len(cells):
        raise ValueError(f"Header/cell mismatch: {len(header_keys)} headers vs {len(cells)} cells")

    flat: Dict[str, Any] = {k: c["value"] for k, c in zip(header_keys, cells)}

    hero_name = cells[0]["link_text"] or cells[0]["text"] or "Unknown"
    hero_id = _slugify(hero_name)

    hero = {
        "id": hero_id,
        "name": hero_name,
        "primaryAttribute": flat.get("A"),
        "base": {
            "str": flat.get("STR"),
            "strGain": flat.get("STR+"),
            "str30": flat.get("STR 30"),

            "agi": flat.get("AGI"),
            "agiGain": flat.get("AGI+"),
            "agi30": flat.get("AGI 30"),

            "int": flat.get("INT"),
            "intGain": flat.get("INT+"),
            "int30": flat.get("INT 30"),

            "total": flat.get("T"),
            "totalGain": flat.get("T+"),
            "total30": flat.get("T30"),

            "ms": flat.get("MS"),
            "armor": flat.get("AR"),

            "dmgMin": flat.get("DMG (MIN)"),
            "dmgMax": flat.get("DMG (MAX)"),

            "range": flat.get("RG"),
            "attackSpeed": flat.get("AS"),
            "bat": flat.get("BAT"),
            "attackPoint": flat.get("ATK PT"),
            "backswing": flat.get("ATK BS"),

            "visionDay": flat.get("VS-D"),
            "visionNight": flat.get("VS-N"),

            "turnRate": flat.get("TR"),
            "collision": flat.get("COL"),

            "hp": flat.get("HP"),
            "hpRegen": flat.get("HP/S"),

            "mp": flat.get("MP"),
            "mpRegen": flat.get("MP/S"),
        },
        "raw": flat,
    }

    return hero


def scrape_heroes(cfg: ScrapeConfig) -> Dict[str, Any]:
    doc, resolved_source = load_document(cfg.source)

    thead = _first(doc.xpath(cfg.thead_xpath))
    if thead is None:
        raise ValueError(f"Could not find THEAD with XPath: {cfg.thead_xpath}")

    table = thead.getparent()
    if table is None or table.tag.lower() != "table":
        raise ValueError("THEAD parent was not a <table>. Page structure may have changed.")

    header_keys = parse_header_keys(thead)

    rows = table.xpath(".//tbody/tr")
    heroes: List[Dict[str, Any]] = []

    for tr in rows:
        if not tr.xpath("./td"):
            continue

        cells = parse_row_cells(tr)

        # Skip odd rows (separators etc.)
        if len(cells) != len(header_keys):
            continue

        heroes.append(to_semantic_hero(header_keys, cells))

    heroes.sort(key=lambda h: h["name"])

    return {
        "source": resolved_source,
        "count": len(heroes),
        "heroes": heroes,
    }


# ---------------------------
# CLI
# ---------------------------

def main():
    p = argparse.ArgumentParser(
        description="Scrape a hero attributes HTML table (URL or local file) into JSON for a static web app."
    )
    p.add_argument(
        "--source",
        required=True,
        help="Either a URL (https://...) or a local HTML file path.",
    )
    p.add_argument(
        "--thead-xpath",
        default='//*[@id="mw-content-text"]/div/div[2]/table/thead',
        help="XPath locating the THEAD element of the target table",
    )
    p.add_argument(
        "--out",
        default="docs/data/heroes.json",
        help="Where to write the output JSON (used by the GitHub Pages app).",
    )

    args = p.parse_args()
    cfg = ScrapeConfig(source=args.source, thead_xpath=args.thead_xpath)

    data = scrape_heroes(cfg)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Wrote {data['count']} heroes to {args.out}")
    print(f"Source: {data['source']}")


if __name__ == "__main__":
    main()
