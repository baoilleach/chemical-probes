"""Build the static browser dataset from the pinned Zenodo record (standard library only)."""

import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


RECORD = "https://zenodo.org/records/20744471"
FILES = {
    "ner_target_disease_pairs.tsv": "9ecadde806d2f9933b9600e302be7d0a",
    "ner_targets.tsv": "b105fd3dc07308240eab4af9f0ce1681",
    "ner_diseases.tsv": "aeb95e923f58607ea4ef09f7574d1683",
    "ner_probes.tsv": "03f1ff13d698d657a96ea9aa5708ad20",
    "ner_probes_triplets_ptpairs_evd.tsv": "bab3c06010aca8e845c0da453c742fd1",
    "ner_probes_triplets_novel.tsv": "70b40c1c944852a5f97de064f863f615",
    "disease_term_blacklist.tsv": "8663479fffc2e983287a6cea94f3d6d2",
}
AREA_LABELS = {
    "EFO_0000319": "cardiovascular disease",
    "EFO_0000540": "immune system disease",
    "EFO_0000618": "nervous system disease",
    "EFO_0000651": "phenotype",
    "EFO_0001379": "endocrine system disease",
    "EFO_0001444": "measurement",
    "EFO_0002571": "medical procedure",
    "EFO_0005741": "infectious disease",
    "EFO_0005803": "hematologic disease",
    "EFO_0005932": "animal disease",
    "EFO_0009605": "pancreas disease",
    "EFO_0009690": "urinary system disease",
    "EFO_0010282": "gastrointestinal disease",
    "EFO_0010285": "integumentary system disease",
    "GO_0008150": "biological process",
    "MONDO_0002025": "psychiatric disorder",
    "MONDO_0021205": "disorder of ear",
    "MONDO_0024458": "disorder of visual system",
    "MONDO_0045024": "cancer or benign tumor",
    "OTAR_0000006": "musculoskeletal or connective tissue disease",
    "OTAR_0000009": "injury, poisoning or other complication",
    "OTAR_0000010": "respiratory or thoracic disease",
    "OTAR_0000014": "pregnancy or perinatal disease",
    "OTAR_0000017": "reproductive system or breast disease",
    "OTAR_0000018": "genetic, familial or congenital disease",
    "OTAR_0000020": "nutritional or metabolic disease",
}


def source_path(source_dir, filename):
    for candidate in (source_dir / filename, source_dir / f"probes_{filename}"):
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Missing {filename} in {source_dir}")


def verify_file(path, checksum):
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != checksum:
        raise ValueError(f"Checksum mismatch: {path}")


def read_rows(path):
    with path.open(encoding="utf-8", newline="") as source:
        yield from csv.DictReader(source, delimiter="\t")


def preferred_area(value):
    identifiers = [part for part in value.split("|") if part]
    return next((part for part in identifiers if part.startswith("OTAR_")), None) or next(
        (part for part in identifiers if part.startswith(("EFO_", "MONDO_"))), None
    ) or (identifiers[0] if identifiers else "")


def parse_phase(value):
    if not value:
        return None
    phase = float(value)
    if phase not in (0.5, 1.0, 2.0, 3.0, 4.0):
        raise ValueError(f"Unexpected clinical phase: {value}")
    return phase


def build(source_dir, output_dir):
    paths = {filename: source_path(source_dir, filename) for filename in FILES}
    for filename, path in paths.items():
        print(f"Verifying {filename}", flush=True)
        verify_file(path, FILES[filename])

    targets = {row["targetId"]: row["geneName"] for row in read_rows(paths["ner_targets.tsv"])}
    diseases = {row["diseaseId"]: row["diseaseName"] for row in read_rows(paths["ner_diseases.tsv"])}
    probes = {row["probeId"]: row["probeName"] for row in read_rows(paths["ner_probes.tsv"])}
    flagged_diseases = {
        row["diseaseId"].strip() for row in read_rows(paths["disease_term_blacklist.tsv"])
    }
    source_pairs = {}
    for row in read_rows(paths["ner_target_disease_pairs.tsv"]):
        key = (row["targetId"], row["diseaseId"])
        if key in source_pairs:
            raise ValueError(f"Duplicate source pair: {key}")
        source_pairs[key] = int(row["articles"])
        targets.setdefault(row["targetId"], row["geneName"])
        if not diseases.get(row["diseaseId"]):
            diseases[row["diseaseId"]] = row["diseaseName"] or row["diseaseId"]

    novel = {
        (row["targetId"], row["diseaseId"])
        for row in read_rows(paths["ner_probes_triplets_novel.tsv"])
    }
    members = defaultdict(lambda: defaultdict(set))
    phases = {}
    area_votes = defaultdict(Counter)
    evidence_rows = 0
    extra_pairs = set()
    for row in read_rows(paths["ner_probes_triplets_ptpairs_evd.tsv"]):
        evidence_rows += 1
        key = (row["targetId"], row["diseaseId"])
        if key not in source_pairs:
            extra_pairs.add(key)
            continue
        probe_id = row["probeId"].strip()
        pmid = row["pmid"].strip()
        if probe_id and pmid:
            members[key][probe_id].add(pmid)
            probes.setdefault(probe_id, row["prefName"] or row["probe"] or probe_id)
        phase = parse_phase(row["phase"].strip())
        if phase is not None:
            phases[key] = max(phase, phases.get(key, phase))
        area = preferred_area(row["therapeuticAreas"].strip())
        if area:
            area_votes[row["diseaseId"]][area] += 1
        if evidence_rows % 100000 == 0:
            print(f"Read {evidence_rows:,} evidence rows", flush=True)

    sorted_targets = sorted(targets.items(), key=lambda item: (item[1].casefold(), item[0]))
    sorted_diseases = sorted(diseases.items(), key=lambda item: (item[1].casefold(), item[0]))
    sorted_probes = sorted(probes.items(), key=lambda item: (item[1].casefold(), item[0]))
    target_index = {identifier: index for index, (identifier, _) in enumerate(sorted_targets)}
    disease_index = {identifier: index for index, (identifier, _) in enumerate(sorted_diseases)}
    probe_index = {identifier: index for index, (identifier, _) in enumerate(sorted_probes)}
    disease_area = {
        identifier: votes.most_common(1)[0][0]
        for identifier, votes in area_votes.items()
        if votes
    }
    pair_rows = []
    mismatches = []
    missing_evidence = []
    for key, source_articles in source_pairs.items():
        target_id, disease_id = key
        probe_groups = [
            [probe_index[probe_id], sorted(pmids, key=lambda value: (not value.isdigit(), int(value) if value.isdigit() else value))]
            for probe_id, pmids in members[key].items()
        ]
        probe_groups.sort(key=lambda group: group[0])
        article_count = len(set().union(*(set(group[1]) for group in probe_groups))) if probe_groups else 0
        if article_count != source_articles:
            mismatches.append([target_id, disease_id, source_articles, article_count])
        if not probe_groups:
            missing_evidence.append([target_id, disease_id])
        pair_rows.append({
            "targetIndex": target_index[target_id],
            "diseaseIndex": disease_index[disease_id],
            "articleCount": article_count,
            "sourceArticles": source_articles,
            "phase": phases.get(key),
            "novel": key in novel,
            "probes": probe_groups,
        })
    pair_rows.sort(key=lambda pair: (pair["diseaseIndex"], pair["targetIndex"]))
    dataset = {
        "meta": {
            "record": RECORD,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "sourceChecksums": FILES,
            "sourceEvidenceRows": evidence_rows,
            "pairCount": len(pair_rows),
            "sourceCountMismatches": len(mismatches),
            "missingEvidencePairs": len(missing_evidence),
            "extraEvidencePairs": len(extra_pairs),
            "flaggedDiseaseCount": sum(identifier in flagged_diseases for identifier in diseases),
            "flaggedPairCount": sum(disease_id in flagged_diseases for _, disease_id in source_pairs),
        },
        "targets": [{"id": identifier, "name": name} for identifier, name in sorted_targets],
        "diseases": [
            {"id": identifier, "name": name, "area": disease_area.get(identifier, ""),
             "flagged": identifier in flagged_diseases}
            for identifier, name in sorted_diseases
        ],
        "probes": [{"id": identifier, "name": name} for identifier, name in sorted_probes],
        "areaLabels": AREA_LABELS,
        "pairs": pair_rows,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "dataset.json").write_text(
        json.dumps(dataset, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    (output_dir / "build-report.json").write_text(
        json.dumps({"meta": dataset["meta"], "mismatches": mismatches, "missingEvidence": missing_evidence,
                    "extraEvidence": sorted(extra_pairs)}, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(pair_rows):,} pairs; {len(mismatches)} count mismatches; {len(missing_evidence)} missing-evidence pairs")


if __name__ == "__main__":
    csv.field_size_limit(2**31 - 1)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=Path("nbu"))
    parser.add_argument("--output-dir", type=Path, default=Path("data"))
    arguments = parser.parse_args()
    build(arguments.source_dir, arguments.output_dir)
