"""Download ChEMBL probe depictions as static SVG assets (standard library only)."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
from http import HTTPStatus
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from xml.etree import ElementTree


IMAGE_URL = "https://www.ebi.ac.uk/chembl/api/data/image/{probe_id}.svg"
PUBCHEM_IMAGE_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/PNG?image_size=300x300"
PUBCHEM_PROPERTY_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/property/InChIKey/JSON"
PUBCHEM_FALLBACKS = {
    "CHEMBL3182444": {"cid": 24748204, "inchi_key": "LCVIRAZGMYMNNT-UHFFFAOYSA-N"},
}
SVG_NAMESPACE = "{http://www.w3.org/2000/svg}svg"
PROBE_ID_PATTERN = re.compile(r"CHEMBL[0-9]+\Z")


def validate_svg(content, probe_id):
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError as error:
        raise ValueError(f"Invalid SVG for {probe_id}: {error}") from error
    if root.tag != SVG_NAMESPACE:
        raise ValueError(f"Unexpected image format for {probe_id}: {root.tag}")


def validate_png(content, probe_id):
    if not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"Unexpected image format for {probe_id}: not PNG")


def fetch(request):
    for attempt in range(4):
        try:
            with urlopen(request, timeout=30) as response:
                return response.read()
        except HTTPError as error:
            if error.code == HTTPStatus.NOT_FOUND:
                return None
            if error.code not in (HTTPStatus.TOO_MANY_REQUESTS, HTTPStatus.BAD_GATEWAY,
                                  HTTPStatus.SERVICE_UNAVAILABLE, HTTPStatus.GATEWAY_TIMEOUT):
                raise
        except (URLError, TimeoutError):
            pass
        if attempt < 3:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not download {request.full_url} after four attempts")


def download_pubchem(probe_id, output_dir, force):
    fallback = PUBCHEM_FALLBACKS[probe_id]
    destination = output_dir / f"{probe_id}.png"
    image_url = PUBCHEM_IMAGE_URL.format(cid=fallback["cid"])
    if destination.is_file() and not force:
        content = destination.read_bytes()
        validate_png(content, probe_id)
        return probe_id, content, "cached", destination.name, image_url

    property_url = PUBCHEM_PROPERTY_URL.format(cid=fallback["cid"])
    property_data = fetch(Request(property_url, headers={"User-Agent": "ChemicalProbeEvidenceViewer/1.0"}))
    if property_data is None:
        raise ValueError(f"PubChem CID {fallback['cid']} no longer exists")
    properties = json.loads(property_data)["PropertyTable"]["Properties"][0]
    if properties["InChIKey"] != fallback["inchi_key"]:
        raise ValueError(f"InChIKey mismatch for {probe_id} at PubChem CID {fallback['cid']}")
    content = fetch(Request(image_url, headers={"User-Agent": "ChemicalProbeEvidenceViewer/1.0"}))
    if content is None:
        raise ValueError(f"PubChem depiction missing for {probe_id}")
    validate_png(content, probe_id)
    temporary = destination.with_suffix(".png.part")
    temporary.write_bytes(content)
    temporary.replace(destination)
    return probe_id, content, "downloaded from PubChem", destination.name, image_url


def download_probe(probe_id, output_dir, force):
    if not PROBE_ID_PATTERN.fullmatch(probe_id):
        raise ValueError(f"Invalid ChEMBL ID: {probe_id}")
    destination = output_dir / f"{probe_id}.svg"
    if destination.is_file() and not force:
        content = destination.read_bytes()
        validate_svg(content, probe_id)
        return probe_id, content, "cached", destination.name, IMAGE_URL.format(probe_id=probe_id)
    if probe_id in PUBCHEM_FALLBACKS:
        return download_pubchem(probe_id, output_dir, force)

    url = IMAGE_URL.format(probe_id=probe_id)
    request = Request(url, headers={"User-Agent": "ChemicalProbeEvidenceViewer/1.0"})
    content = fetch(request)
    if content is None:
        return probe_id, None, "unavailable", None, url
    validate_svg(content, probe_id)
    temporary = destination.with_suffix(".svg.part")
    temporary.write_bytes(content)
    temporary.replace(destination)
    return probe_id, content, "downloaded", destination.name, url


def download_all(dataset_path, output_dir, workers, force):
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    probe_ids = sorted({probe["id"] for probe in dataset["probes"]})
    output_dir.mkdir(parents=True, exist_ok=True)
    available = {}
    unavailable = []
    failures = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(download_probe, probe_id, output_dir, force): probe_id
            for probe_id in probe_ids
        }
        for position, future in enumerate(as_completed(futures), start=1):
            probe_id = futures[future]
            try:
                identifier, content, status, filename, source_url = future.result()
                if content is None:
                    unavailable.append(identifier)
                else:
                    available[identifier] = {
                        "path": filename,
                        "source": source_url,
                        "bytes": len(content),
                        "sha256": hashlib.sha256(content).hexdigest(),
                    }
            except Exception as error:
                failures.append(f"{probe_id}: {error}")
                status = "failed"
            print(f"[{position}/{len(probe_ids)}] {probe_id}: {status}", flush=True)

    if failures:
        raise RuntimeError("Download failures:\n" + "\n".join(failures))
    manifest = {
        "source": IMAGE_URL,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "probeCount": len(probe_ids),
        "available": sorted(available),
        "unavailable": sorted(unavailable),
        "files": dict(sorted(available.items())),
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Saved {len(available)} images; {len(unavailable)} unavailable", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path("data/dataset.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("assets/probes"))
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--force", action="store_true")
    arguments = parser.parse_args()
    if arguments.workers < 1:
        parser.error("--workers must be positive")
    download_all(arguments.dataset, arguments.output_dir, arguments.workers, arguments.force)
