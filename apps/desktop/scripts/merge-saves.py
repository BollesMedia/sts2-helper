#!/usr/bin/env python3
"""
STS2 Save File Recovery: Merge history + sync progress.save

The modded save is the complete superset. This script:
1. Backs up BOTH save directories
2. Merges run history files from both into both
3. Copies the modded progress.save to the unmodded path

Run: python3 merge-saves.py
"""

import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

STEAM_ID = "76561198018482804"
BASE = Path.home() / "Library/Application Support/SlayTheSpire2/steam" / STEAM_ID

MODDED_SAVES = BASE / "modded/profile1/saves"
UNMODDED_SAVES = BASE / "profile1/saves"

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")


def check_paths():
    """Verify both save directories exist."""
    if not MODDED_SAVES.exists():
        print(f"ERROR: Modded saves not found at {MODDED_SAVES}")
        sys.exit(1)
    if not UNMODDED_SAVES.exists():
        print(f"ERROR: Unmodded saves not found at {UNMODDED_SAVES}")
        sys.exit(1)
    print(f"Modded saves:   {MODDED_SAVES}")
    print(f"Unmodded saves: {UNMODDED_SAVES}")


def backup_saves():
    """Create full backup of both save directories."""
    for label, src in [("modded", MODDED_SAVES), ("unmodded", UNMODDED_SAVES)]:
        dst = src.parent / f"saves.pre-merge-{TIMESTAMP}"
        print(f"\nBacking up {label}: {src} → {dst}")
        shutil.copytree(src, dst)
        print(f"  ✓ Backup created ({sum(1 for _ in dst.rglob('*'))} files)")
    print()


def analyze_saves():
    """Print summary of both saves before merging."""
    for label, saves_dir in [("MODDED", MODDED_SAVES), ("UNMODDED", UNMODDED_SAVES)]:
        progress = saves_dir / "progress.save"
        history_dir = saves_dir / "history"

        print(f"--- {label} ---")
        if progress.exists():
            data = json.loads(progress.read_text())
            char_stats = data.get("character_stats", [])
            max_asc = max((cs.get("max_ascension", 0) for cs in char_stats), default=0)
            total_wins = sum(
                cs.get("wins", 0)
                for anc in data.get("ancient_stats", [])
                for cs in anc.get("character_stats", [])
            )
            total_losses = sum(
                cs.get("losses", 0)
                for anc in data.get("ancient_stats", [])
                for cs in anc.get("character_stats", [])
            )
            cards = len(data.get("discovered_cards", []))
            print(f"  progress.save: {progress.stat().st_size:,} bytes")
            print(f"  Max ascension: A{max_asc}")
            print(f"  Total runs: {total_wins + total_losses} ({total_wins}W / {total_losses}L)")
            print(f"  Cards discovered: {cards}")
        else:
            print("  progress.save: NOT FOUND")

        if history_dir.exists():
            run_files = list(history_dir.glob("*.run"))
            print(f"  History files: {len(run_files)}")
        else:
            print("  History dir: NOT FOUND")
        print()


def merge_history():
    """Copy unique .run files into both history directories."""
    modded_history = MODDED_SAVES / "history"
    unmodded_history = UNMODDED_SAVES / "history"

    modded_history.mkdir(exist_ok=True)
    unmodded_history.mkdir(exist_ok=True)

    modded_runs = {f.name for f in modded_history.glob("*.run")}
    unmodded_runs = {f.name for f in unmodded_history.glob("*.run")}

    # Runs only in unmodded → copy to modded
    only_unmodded = unmodded_runs - modded_runs
    for name in sorted(only_unmodded):
        src = unmodded_history / name
        dst = modded_history / name
        shutil.copy2(src, dst)
    print(f"Copied {len(only_unmodded)} history files: unmodded → modded")

    # Runs only in modded → copy to unmodded
    only_modded = modded_runs - unmodded_runs
    for name in sorted(only_modded):
        src = modded_history / name
        dst = unmodded_history / name
        shutil.copy2(src, dst)
    print(f"Copied {len(only_modded)} history files: modded → unmodded")

    # Verify
    final_modded = len(list(modded_history.glob("*.run")))
    final_unmodded = len(list(unmodded_history.glob("*.run")))
    print(f"Final history count: modded={final_modded}, unmodded={final_unmodded}")
    assert final_modded == final_unmodded, "History counts don't match!"


def sync_progress():
    """Copy modded progress.save to unmodded path."""
    src = MODDED_SAVES / "progress.save"
    dst = UNMODDED_SAVES / "progress.save"
    shutil.copy2(src, dst)
    print(f"Synced progress.save: modded → unmodded ({src.stat().st_size:,} bytes)")


def verify():
    """Print final state of both save directories."""
    print("\n=== VERIFICATION ===\n")
    analyze_saves()

    # Confirm both progress.save files are identical
    modded_data = (MODDED_SAVES / "progress.save").read_bytes()
    unmodded_data = (UNMODDED_SAVES / "progress.save").read_bytes()
    if modded_data == unmodded_data:
        print("✓ Both progress.save files are identical")
    else:
        print("⚠ progress.save files differ!")

    # Confirm history counts match
    modded_count = len(list((MODDED_SAVES / "history").glob("*.run")))
    unmodded_count = len(list((UNMODDED_SAVES / "history").glob("*.run")))
    if modded_count == unmodded_count:
        print(f"✓ Both history folders have {modded_count} run files")
    else:
        print(f"⚠ History counts differ: modded={modded_count}, unmodded={unmodded_count}")


def main():
    print("=" * 60)
    print("  STS2 Save File Recovery")
    print("=" * 60)
    print()

    check_paths()
    print()

    print("=== CURRENT STATE ===\n")
    analyze_saves()

    print("=== PLANNED ACTIONS ===")
    print("1. Back up both save directories")
    print("2. Merge run history files (copy unique .run files to both dirs)")
    print("3. Copy modded progress.save → unmodded progress.save")
    print()

    confirm = input("Proceed? (yes/no): ").strip().lower()
    if confirm != "yes":
        print("Aborted.")
        sys.exit(0)

    print("\n=== STEP 1: BACKUP ===")
    backup_saves()

    print("=== STEP 2: MERGE HISTORY ===")
    merge_history()

    print("\n=== STEP 3: SYNC PROGRESS ===")
    sync_progress()

    verify()

    print("\n✓ Done! Launch the game and verify your run history + ascension level.")


if __name__ == "__main__":
    main()
