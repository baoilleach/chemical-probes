# Chemical probe evidence viewer

## Goal

Build a JavaScript web app that lets researchers explore the **full target × disease matrix** of chemical probe literature evidence in the [Zenodo dataset](https://zenodo.org/records/20744471). Use the attached matrix image as a visual reference: targets (gene symbols) across columns, diseases down rows, therapeutic-area grouping, and a bubble at each observed pair. Unlike the image's selected subset, the viewer must make every observed pair in the source data accessible and let users filter the matrix. The interactive chart and its cell details are sufficient to present the results; no separate written interpretation is required. The app runs as static files with no backend and minimal runtime dependencies.

## Run the viewer

The generated browser dataset is included in `data/dataset.json`; no build step or package install is needed to view it. From this directory, run `python3 -m http.server 8000` and open `http://localhost:8000/`. Any static web host can serve the same files. Opening `index.html` directly with `file://` may prevent the browser from loading the JSON file.

To rebuild the dataset, download the pinned files into the Git-ignored `nbu/` folder, then run `python3 scripts/build_data.py`. The builder uses only Python's standard library, accepts both the exact Zenodo filenames and the existing `probes_`-prefixed copies in `nbu/`, and verifies each file's MD5 checksum before producing `data/dataset.json` and `data/build-report.json`.

```sh
mkdir -p nbu
for name in ner_target_disease_pairs.tsv ner_targets.tsv ner_diseases.tsv ner_probes.tsv ner_probes_triplets_ptpairs_evd.tsv ner_probes_triplets_novel.tsv disease_term_blacklist.tsv; do
  curl -fL "https://zenodo.org/api/records/20744471/files/$name/content" -o "nbu/$name"
done
python3 scripts/build_data.py
```

The annotated file is about 914 MB and stays in `nbu/`; the static browser file is about 1 MB. The current build verifies 820,933 evidence rows and 5,521 pairs, with no missing evidence or article-count mismatches.

Probe structure images are stored as static assets in `assets/probes/`; the browser does not call ChEMBL or PubChem. After rebuilding the dataset, run `python3 scripts/download_probe_images.py` to fill missing images, or add `--force` to re-download every image. The script checks existing images and writes a source and SHA-256 manifest. There are 193 ChEMBL SVGs and one PubChem PNG: ChEMBL's image and molecule endpoints return 404 for `CHEMBL3182444` (MK-5108), so the script uses PubChem CID `24748204` after checking that its InChIKey matches the Zenodo record (`LCVIRAZGMYMNNT-UHFFFAOYSA-N`).

## Verified source data

The Zenodo record, *Chemical Probes in Scientific Literature: A Pipeline for Target-Disease Evidence*, contains the data. The associated [analysis code](https://github.com/chembl/chemical_probes_lit) documents how the pipeline constructs and plots probe–target–disease evidence. Pin the published Zenodo record and its file checksums during data preparation so a later record update cannot silently change the display.

| File in the Zenodo record | Role |
| --- | --- |
| `ner_target_disease_pairs.tsv` (441 KB; 5,521 data rows) | Starting list of observed pairs: `targetId`, `geneName`, `diseaseId`, `diseaseName`, `chemical probe (max phase)[sentences]`, `articles`. |
| `ner_targets.tsv` (4.8 KB; 161 data rows) | Target labels and source-level counts. |
| `ner_diseases.tsv` (56 KB; 1,352 data rows) | Disease labels and source-level counts. |
| `ner_probes.tsv` (6.1 KB; 194 data rows) | Probe labels and source-level counts. |
| `ner_probes_triplets_ptpairs_evd.tsv` (914 MB) | Article-level annotated evidence, including `targetId`, `diseaseId`, `probeId`, `pmid`, `gene`, `name`, `therapeuticAreas`, and `phase`; use during preparation for reliable pair-level probe counts, clinical phase, therapeutic area, and drill-down evidence. Do not make browsers download this file. |
| `ner_probes_triplets_novel.tsv` and `ner_probes_early_literature.tsv` | Optional flags or dedicated views for the published novel and early-literature subsets; preserve their stated selection rules. |
| `disease_term_blacklist.tsv` | Check whether excluded disease terms appear in the chosen pair data before rendering. |

The record description calls the pair file `ner_target_disease-pairs.tsv`, but the downloadable filename is `ner_target_disease_pairs.tsv`. Treat the filenames above as the source of truth.

## Data semantics

- One cell is one observed target ID–disease ID pair. Its bubble area represents the number of distinct probe IDs; colour represents the number of distinct article identifiers on a logarithmic scale. The source calls the identifier field `pmid`, but it includes numeric PMIDs, PMC IDs, and PPR preprint IDs; detail links route to PubMed or Europe PMC accordingly. The text is the pair's highest matched Open Targets clinical phase (`0.5`, `1`, `2`, `3`, or `4`); `n` means no phase was matched in the source. This phase belongs to the target–disease pair, not to the selected probe.
- The builder deduplicates repeated evidence rows by pair, probe ID, and article identifier. The unfiltered distinct article totals match the Zenodo pair-summary `articles` field for all 5,521 pairs. When probes are selected, the viewer counts only those probes and takes the union of their article identifiers, so an article mentioning multiple selected probes counts once.
- Therapeutic areas use the first `OTAR_` ID in the source's `therapeuticAreas` field, otherwise the first `EFO_`/`MONDO_` ID, then the first other ID. Labels are pinned in the builder from Open Targets and EBI OLS. Some legacy EFO terms are marked obsolete in current OLS; their source IDs remain unchanged. If no area is provided, the disease is shown as Unclassified.
- Four source disease names are empty; the viewer shows their stable disease IDs in place of a name.
- The source blacklist flags 25 disease terms present in the pair summary as possible NER false positives. They remain visible by default to preserve the complete source matrix, are marked with ⚠, and can be hidden with a filter. A blank cell means **no observed pair in this dataset**, not evidence of no biological association.

## Viewer requirements

- Show all observed pairs in a scrollable, zoomable, sparse matrix, with gene-symbol column labels and disease-name row labels. Group or annotate rows by therapeutic area where the dataset supplies one. Provide a visible legend and explicit definitions for counts, colour scale, and phase labels; keep empty and zero-valued states distinct.
- Offer text search and multi-select filters for target, disease, therapeutic area, probe, evidence volume, and clinical phase. Filters update the displayed matrix, counts, and detail panel together. When a probe filter is active, recalculate bubble sizes and article counts from the matching probes' evidence and visibly label the view as filtered; do not present unfiltered pair totals as filtered counts. Add a one-click reset and show the number of displayed targets, diseases, and observed pairs.
- On hover or keyboard focus, summarize a cell; on click, open a detail panel with target and disease identifiers, distinct probe count and names, distinct article count, maximum phase, therapeutic area, and source-linked article/probe evidence when available. Make the pair's original records traceable from the Zenodo record.
- Let users sort rows and columns by name or evidence volume, and choose whether unmatched rows/columns remain visible. Preserve a shareable view in URL query parameters. Provide an accessible tabular alternative or downloadable CSV for the filtered pairs.
- Explain that the data are literature-derived associations and that counts and phases do not by themselves establish causality or clinical efficacy. Cite the Zenodo record and analysis repository in the interface.

## Implementation plan

1. **Confirm definitions and scope.** Inspect the analysis notebook and sample source rows to establish how distinct articles, distinct probes, clinical phase, and preferred therapeutic area are calculated. Resolve ambiguous or missing values and document the rules. Check that all 5,521 pair rows can be represented, including pairs without a therapeutic area or clinical phase.
2. **Prepare a static dataset.** Add a repeatable, local preprocessing script that downloads or reads the pinned Zenodo files, verifies checksums, joins by stable IDs, deduplicates probe IDs and article identifiers per pair, and emits compact JSON or TSV for the browser. Preserve pair–probe–article membership so probe-filtered article counts use the union of matching article IDs and do not double-count articles mentioning multiple probes. Split detailed article-level evidence into optional chunks if needed. Record the source record ID, checksums, transformation version, and generated row counts. Avoid parsing the 914 MB file on page load.
3. **Build the browser UI.** Use plain HTML, CSS, and modern JavaScript modules; avoid a framework unless the interaction proves difficult without one. Render only visible cells/labels while scrolling (Canvas or virtualized SVG/HTML) so the full matrix remains responsive. Keep tooltips, selection, legends, and filters synchronized with the same normalized pair data.
4. **Validate against the sources.** Compare generated pair and unique-entity counts with the source summaries; spot-check several cells, including blank phase and multiple-probe cases, against the raw rows and reference figure. Test combined filters, reset/shareable URLs, keyboard access, responsive layout, and browser performance with the complete dataset.
5. **Publish as static assets.** Document the data refresh command, attribution, and a simple local static-server workflow. Deploy the generated assets to any static host; no server-side API, database, or runtime data transformation is required.

## Acceptance criteria

- Every source pair is discoverable through the matrix or filters, with no hard-coded target or disease subset.
- The displayed article, probe, phase (including `0.5`), and therapeutic-area values are reproducible from the pinned source data and documented aggregation rules.
- Filtering and cell details stay consistent, including recalculated probe-filtered metrics and a visible filtered-state label. The full dataset loads without fetching the 914 MB source file, and the app works from a static host without a backend.
