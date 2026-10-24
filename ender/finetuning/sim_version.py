"""Current SHA256 of the simulator modules, for run-provenance footnotes."""

import hashlib
from pathlib import Path

SIM = Path(__file__).resolve().parents[1] / "datasets" / "sim"


def current_sim_hashes() -> dict[str, str]:
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(SIM.glob("*.py")) if p.name != "__init__.py"}


if __name__ == "__main__":
    import json
    print(json.dumps(current_sim_hashes(), indent=2))
