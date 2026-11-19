# Chemical probe evidence atlas

Explore chemical probe evidence for target–disease associations in an interactive matrix. The viewer covers 5,521 observed pairs, 161 targets, 1,352 diseases, and 194 chemical probes from the [Zenodo dataset](https://zenodo.org/records/20744471).

Developed by the [Chemical Biology Resources team at EMBL-EBI](https://www.ebi.ac.uk/about/teams/chemical-biology-resources/) with funding from [Open Targets](https://opentargets.org/).

## Run locally

No installation or build step is needed. From this directory, run:

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000/](http://localhost:8000/). The app can also be hosted on any static web server. Opening `index.html` directly from the filesystem may prevent the browser from loading the dataset.

## Use the viewer

- Search or filter by target, disease, therapeutic area, chemical probe, article count, or clinical phase. Probe filters recalculate the displayed probe and article counts.
- Scroll the matrix to explore all pairs. Bubble size shows distinct probes, colour shows distinct article IDs, and the label shows the highest matched clinical phase (`n` means no matched phase).
- Click a bubble or **View evidence** in the table to see probe structures, article links, and source identifiers. Use the arrow keys and Enter when the matrix is focused.
- Download the currently filtered pairs as CSV. The URL preserves your filters so you can share a view.

The dataset and probe images are bundled locally; viewing the app does not call external APIs. Literature associations are exploratory evidence, not proof of causality or clinical efficacy. Disease terms marked ⚠ appear in the source blacklist of possible extraction errors.

For data provenance, regeneration commands, and implementation details, see [PROJECT_PLAN.md](PROJECT_PLAN.md). The analysis code is available in [chembl/chemical_probes_lit](https://github.com/chembl/chemical_probes_lit).
