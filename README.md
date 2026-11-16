# Chemical probe evidence viewer

## Goal

Build a JavaScript web app that lets researchers explore the **full target × disease matrix** of chemical probe literature evidence in the [Zenodo dataset](https://zenodo.org/records/20744471). Use the attached matrix image as a visual reference: targets (gene symbols) across columns, diseases down rows, therapeutic-area grouping, and a bubble at each observed pair. Unlike the image's selected subset, the viewer must make every observed pair in the source data accessible and let users filter the matrix. The interactive chart and its cell details are sufficient to present the results; no separate written interpretation is required. The app runs as static files with no backend and minimal runtime dependencies.

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

The record description calls the pair file `ner_target_disease-pairs.tsv`, but the downloadable filename is `ner_target_disease_pairs.tsv`. Treat the filenames above as the source of truth. Verify the meaning of each metric against the plotting notebook before assigning visual encodings; the screenshot suggests bubble size = number of distinct probes, colour = number of distinct articles on a log scale, and labels `0`–`4`/`n` = maximum clinical phase/no reported phase. A blank cell means **no observed pair in this dataset**, not evidence of no biological association.

## Viewer requirements

- Show all observed pairs in a scrollable, zoomable, sparse matrix, with gene-symbol column labels and disease-name row labels. Group or annotate rows by therapeutic area where the dataset supplies one. Provide a visible legend and explicit definitions for counts, colour scale, and phase labels; keep empty and zero-valued states distinct.
- Offer text search and multi-select filters for target, disease, therapeutic area, probe, evidence volume, and clinical phase. Filters update the displayed matrix, counts, and detail panel together. When a probe filter is active, recalculate bubble sizes and article counts from the matching probes' evidence and visibly label the view as filtered; do not present unfiltered pair totals as filtered counts. Add a one-click reset and show the number of displayed targets, diseases, and observed pairs.
- On hover or keyboard focus, summarize a cell; on click, open a detail panel with target and disease identifiers, distinct probe count and names, distinct PMID count, maximum phase, therapeutic area, and source-linked PMID/probe evidence when available. Make the pair's original records traceable from the Zenodo record.
- Let users sort rows and columns by name or evidence volume, and choose whether unmatched rows/columns remain visible. Preserve a shareable view in URL query parameters. Provide an accessible tabular alternative or downloadable CSV for the filtered pairs.
- Explain that the data are literature-derived associations and that counts and phases do not by themselves establish causality or clinical efficacy. Cite the Zenodo record and analysis repository in the interface.

## Implementation plan

1. **Confirm definitions and scope.** Inspect the analysis notebook and sample source rows to establish how distinct articles, distinct probes, clinical phase, and preferred therapeutic area are calculated. Resolve ambiguous or missing values and document the rules. Check that all 5,521 pair rows can be represented, including pairs without a therapeutic area or clinical phase.
2. **Prepare a static dataset.** Add a repeatable, local preprocessing script that downloads or reads the pinned Zenodo files, verifies checksums, joins by stable IDs, deduplicates probe IDs and PMIDs per pair, and emits compact JSON or TSV for the browser. Preserve pair–probe–PMID membership so probe-filtered article counts use the union of matching PMIDs and do not double-count articles mentioning multiple probes. Split detailed article-level evidence into optional chunks if needed. Record the source record ID, checksums, transformation version, and generated row counts. Avoid parsing the 914 MB file on page load.
3. **Build the browser UI.** Use plain HTML, CSS, and modern JavaScript modules; avoid a framework unless the interaction proves difficult without one. Render only visible cells/labels while scrolling (Canvas or virtualized SVG/HTML) so the full matrix remains responsive. Keep tooltips, selection, legends, and filters synchronized with the same normalized pair data.
4. **Validate against the sources.** Compare generated pair and unique-entity counts with the source summaries; spot-check several cells, including blank phase and multiple-probe cases, against the raw rows and reference figure. Test combined filters, reset/shareable URLs, keyboard access, responsive layout, and browser performance with the complete dataset.
5. **Publish as static assets.** Document the data refresh command, attribution, and a simple local static-server workflow. Deploy the generated assets to any static host; no server-side API, database, or runtime data transformation is required.

## Acceptance criteria

- Every source pair is discoverable through the matrix or filters, with no hard-coded target or disease subset.
- The displayed article, probe, phase, and therapeutic-area values are reproducible from the pinned source data and documented aggregation rules.
- Filtering and cell details stay consistent, including recalculated probe-filtered metrics and a visible filtered-state label. The full dataset loads without fetching the 914 MB source file, and the app works from a static host without a backend.
