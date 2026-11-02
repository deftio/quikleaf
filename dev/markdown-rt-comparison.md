# markdown-rt compared — executable documents and notebooks

Companion to `markdown-rt-spec.md`. Draft 0.1 · 2026-11-01.

This document compares markdown-rt with two families of prior art: **executable Markdown formats**
(the same scope, different grammar) and **notebooks** (Jupyter, Wolfram, Observable, Pluto, Marimo,
Livebook, MATLAB, Maple, Hex, Zeppelin, and the spreadsheet). The notebook comparison is about
*style* — file format, cell model, execution order, state, outputs, reactivity, addressing, trust —
not about scope. Nobody is proposing that markdown-rt replace Mathematica. The question is what forty
years of notebook design got right and wrong, and which of those lessons a Markdown-shaped format can
take without becoming one more notebook.

The short version: every system that stored outputs in the file regretted it; every system that let
cells run in any order grew a reproducibility problem and later bolted on reactivity; every system with
a proprietary file format lost its users' diffs; and the two ideas that aged best are *named* cells
and *declared* dependencies. The wheel markdown-rt wants — plain Markdown file, named fences, reactive
re-run, sandboxed browser execution, file as the only state — does not exist as one wheel, which is
why the comparison ends where it does.

---

## 1. Executable Markdown formats

Same scope as markdown-rt: Markdown text with code that runs.

| Format | Cell marker | Addressing | Re-run model | Outputs live in | Runs where | Plain-Markdown degrade | Typical use |
|---|---|---|---|---|---|---|---|
| Jupytext / MyST-NB | ```` ```{code-cell} python ```` + `:tags:` | `(label)=`, `:name:` | in order, cache | cache / `.ipynb` | kernel | partial (directive shows as code with odd language) | books, docs |
| R Markdown / knitr | ```` ```{r label, echo=FALSE} ```` | chunk label | in order | rendered output | R at knit time | poor (braces hide language) | reports |
| Quarto | ```` ```{python} ```` + `#\| label:` comments | label | in order, `freeze` | rendered output | kernel at render | medium | publishing |
| Observable Framework | ```` ```js ```` | variable names | reactive by free variables | DOM | browser | good (plain code block) | dashboards |
| MDX | JSX, `import`/`export` | component names | none | component tree | build + browser | none (JSX breaks renderers) | doc sites |
| Runme | ```` ```sh {"name":"x"} ```` (JSON attrs) | `name` | manual | terminal | shell | good | runbooks |
| Rundown | Markdown + invisible tags | section labels | manual | terminal | shell | good | runbooks, CLIs |
| Markdown Preview Enhanced | ```` ```js {cmd=node output=html} ```` | none | manual / on save | preview | node etc. | medium | previews |
| Livebook `.livemd` | ```` ```elixir ```` + `<!-- livebook:{…} -->` | bindings | dependency graph, stale marks | `<!-- livebook:{"output":true} -->` blocks in file (optional) | Elixir | good | Elixir notebooks |
| Docusaurus live blocks | ```` ```jsx live ```` | none | none | DOM | browser | good | component demos |
| **markdown-rt** | ```` ```js run #id in(…) ```` | `#id` on any fence | declared + observed reads, tick scheduler, round cap | DOM slot; file only via explicit `set`/`out` | sandboxed iframe in browser | good (plain code; language still highlighted) | live reports, editors, agent output |

What markdown-rt takes from this family:

- From Pandoc/Djot/MyST: a fence-level `#id`, but without braces as the required form.
- From Observable Framework: reactive re-run driven by what a cell actually read, plus explicit `in` for the conditional case.
- From Quarto/knitr: per-cell execution options expressed as pragmas, but in the info string, not in `#|` comments or braces.
- From Runme/Rundown: "invisible to GitHub" as a hard requirement.
- From Livebook: stale marks in manual mode (§3.6 below).

What it rejects, and why:

- Outputs in the file (Livebook optional, Jupytext via `.ipynb`): noisy diffs, stale results, and a second parser for the output envelope. `out` covers the cases that need persistence.
- Braces as the only attribute syntax (Pandoc, MPE, knitr): hides the language from first-word renderers when placed first, and adds a quoting layer for no gain.
- JSON in the info string (Runme): correct but unreadable at a glance.
- Free-variable reactivity (Observable): needs a parser per language and makes dependencies implicit in a way an author cannot see in the source. Observed reads give the same convenience with an id-based, language-neutral mechanism.

---

## 2. Notebooks, compared on style

| System | File | Cell model | Execution order | State between cells | Outputs stored | Reactivity | Addressing | Degrades without the tool |
|---|---|---|---|---|---|---|---|---|
| Jupyter | JSON (`.ipynb`) | code / markdown / raw cells | any order the user clicks; counter `In[n]` | one kernel, all globals | yes, in file, with MIME bundles | none (extensions only) | execution count; cell id since nbformat 4.5 | no (JSON) |
| Wolfram Notebook | `.nb`, machine-written Wolfram expression | styled cells in a bracket hierarchy (Title → Section → Input → Output) | any order; `In[n]`/`Out[n]`, `%` for last result | one kernel | yes, in file, including graphics | `Dynamic[]`, `Manipulate[]` in outputs | `CellTags`, `CellLabel`, `%n` | no (needs kernel or CDF Player) |
| Observable notebook | cells in a database; exports as a JS module | named JS cells, `viewof` inputs | topological, by free variables; document order irrelevant | reactive dataflow, no shared mutable globals | no | full | cell names; `import {x} from "@user/nb"` | no (platform) |
| Pluto.jl | plain `.jl` script with `# ╔═╡ uuid` markers and a cell-order block | one expression per cell | topological, by variable analysis; one definition per variable | reactive | no | full | UUID | yes (runs as a script) |
| Marimo | plain `.py`; each cell a decorated function | cells as functions; params are dependencies | topological; autorun or lazy | reactive; no redefinition | no | full | function name | yes (runs as a script, or as an app) |
| Livebook | `.livemd` Markdown | elixir fences + metadata comments | document order; dependents marked **stale** | one runtime per notebook; branching sections fork it | optional, in HTML comments | stale marks, optional auto-reevaluate | bindings | yes (Markdown) |
| MATLAB Live Script | `.mlx` (zipped XML) | sections split by `%%` | in order or by section | one workspace | yes, in file | live controls write values back into the code | section titles | no |
| Maple worksheet | `.mw` XML | execution groups; document mode hides input | in order | one session | yes | none | labels `(1)` for equations | no |
| Hex / Deepnote / Colab | Jupyter-shaped JSON + project metadata | code, SQL, markdown, input cells | Hex: reactive DAG with graph view; others: Jupyter order | kernel | yes | Hex yes; others opt-in | named dataframes (Hex), cell ids | no |
| Zeppelin | JSON note | paragraphs with `%interpreter` | in order or by click | per interpreter | yes | none; `${name=default}` dynamic forms re-run a paragraph | paragraph id | no |
| Org Babel | plain `.org` text | `#+begin_src` blocks | in order or by call; `:session` | per session | `#+RESULTS:` in file, replace or append | none | `#+NAME:`, `:var x=name`, noweb `<<name()>>` | partial (Org renders on GitHub) |
| Spreadsheet (Excel) | binary / XML | one formula per cell | by dependency, always | the grid is the state | values cached in file | full; circular refs allowed with an iteration cap | A1 / named ranges | no |
| **markdown-rt** | plain `.md` | fences with pragmas | tick: dependents of what changed, topological, document-order tiebreak, round cap | one sandboxed realm per document; `mrt.state` | no, unless a cell writes a fence | declared + observed | `#id` | yes (ordinary Markdown) |

---

## 3. What the notebooks teach

### 3.1 Jupyter

Positive

- **The MIME bundle.** An output carries several representations (`text/plain`, `image/png`, `application/vnd.vegalite.v5+json`) and the viewer picks the richest it can show. markdown-rt gets the same property for free because an output is Markdown: a ```` ```vega-lite ```` fence in a slot is a chart in quikleaf and readable JSON on GitHub. Keep that property deliberate: every output must have a plain-text reading.
- **The trust model.** Stored outputs may contain HTML and JavaScript, so Jupyter signs a notebook when *the user* executes it and refuses to run output scripts from unsigned files. That is the `allowExecution` problem solved twenty years ago, and the UX lesson is: trust is per document, remembered, and earned by the user's own action. markdown-rt should let a host remember "the user clicked Run All on this path" so `manual` does not mean "click Run All every time you open the file".
- **Parameterised runs** (papermill's `parameters` tag) are the origin of `run(args)`: a cell is a function, a document is a program with inputs.
- **Cell ids** arrived in nbformat 4.5 after fifteen years of positional references breaking. Named fences from day one.

Negative

- **Hidden state and arbitrary order.** The cell you see is not the cell that ran. A 2019 study of about 860k GitHub notebooks found roughly a quarter executed without error and about 4% reproduced their stored results. Every reactive notebook since (Observable, Pluto, Marimo) exists to fix this. markdown-rt's tick order is defined by the document, and "Restart runtime" is the only way to clear state.
- **JSON file, outputs inside.** Unreadable diffs, merge conflicts on execution counters, base64 images in version control; a whole tool category (nbdime, jupytext, nbstripout) exists to undo this. Plain text, outputs out of the file.
- **Narrative is second-class.** Markdown cells cannot refer to code cells; there is no way to say "the table above". Fence ids and `mrt.get` make the prose and the code one namespace.
- **Widget state is not in the file** (ipywidgets): reopening shows dead controls. If markdown-rt ever adds inputs, the spec must say where their values live, or they must have none.

### 3.2 Wolfram / Mathematica

Positive

- **Cell options are a complete vocabulary**: `Evaluatable`, `Editable`, `Deletable`, `CellOpen`, `InitializationCell`, `CellTags`, `CellLabel`, `TimeConstrained` around evaluation. This maps almost one-to-one onto the pragma table (§4 below) and is evidence the table is the right size. `Editable->False` is also the precedent for an *advisory* editor lock: it is a cell option the user can flip in the Option Inspector, which is exactly the `write=` design.
- **The bracket hierarchy.** Cells nest under section cells, and the cell bracket is a handle: click a section's bracket to select and evaluate the whole section. Markdown headings already give the tree; the gesture worth copying is "run this section".
- **The notebook is an expression.** `Notebook[{Cell[…]}]` is Wolfram data, and `NotebookWrite`, `SelectionMove`, `NotebookRead` let a program edit the document it lives in. Self-modifying documents have a thirty-year track record here, which is the answer to anyone who thinks `mrt.set` is exotic. The caveat, learned the hard way, is also theirs: a document that modifies itself on open is a security problem, hence the next point.
- **The "potentially unsafe dynamic content" dialog and `$TrustedPath`.** Wolfram arrived at the same host-ceiling rule: dynamic content does not evaluate on open unless the file is in a trusted location or the user says yes. markdown-rt `off`/`manual`/`auto` plus remembered per-document trust is that policy without the modal dialog.
- **`Dynamic[]`** puts reactivity at expression granularity inside an output. `md run` with `${…}` is the Markdown-sized version: a sentence whose number updates.

Negative

- **The `.nb` file** is text in theory and unreadable in practice: machine-generated, enormous, with cached graphics inline. Diffs are useless; the file is a serialization, not a document. The lesson is the same as Jupyter's, stronger: the file a human reads and the file the tool writes must be the same file.
- **Kernel required.** Without Mathematica (or the Player) a notebook is nothing. markdown-rt without a runtime is a Markdown file with code blocks, which is still the whole document.
- **`%` and `In[n]`/`Out[n]`** address results by history position. Convenient at the keyboard, meaningless the next day. Named fences only.
- **Hidden state** as in Jupyter, with its own ritual (`Clear["Global`*"]`).

### 3.3 Observable (notebooks, then Framework)

Positive

- **Reactive dataflow by name**, topologically ordered, no hidden state. The mental model is the spreadsheet's, applied to code. markdown-rt's tick is this with ids instead of free variables so it works for any language.
- **`viewof`**: an input element *is* a reactive value. If markdown-rt adds inputs, this is the shape.
- **Generators for animation** (`yield` per frame) and async everywhere.
- **Sandboxing**: user code runs in an iframe on a separate origin (`observableusercontent.com`). Same architecture as the markdown-rt realm, and proof it is workable for serious interactive work.
- **The Observable Runtime** is a separate library from the editor. `quikdown-rt` as a module the editor consumes follows the same split.

Negative

- **Document order does not matter**, so authors stop writing documents top-down and readers lose the ability to read one. markdown-rt keeps document order as the tiebreak and as the only order a reader needs to know.
- **Cells lived in a database**, exportable as a JS module, not a file in your editor. Observable's own answer was Framework: *Markdown files on disk*, built statically. A reactive-notebook company moving to Markdown files is the strongest external validation this format has.
- **Framework is not sandboxed from its page** and has no write-back; it is a site generator, not an editor.

### 3.4 Pluto.jl and Marimo

Positive

- **The file is valid in the host language.** A Pluto notebook is a `.jl` script; a Marimo notebook is a `.py` where each cell is a function. Run it without the tool and it works. markdown-rt's equivalent is "the file is valid Markdown", and this is why `svg:pragma` was rejected: it would break the equivalent property.
- **Outputs are not stored.** Both chose this on purpose, for diffs and honesty, and both are fine.
- **One definition per variable / cells as functions with explicit parameters.** Marimo's cell signature `def _(sales, config):` is `in(sales, config)` with the compiler enforcing it. Marimo's `lazy` vs `autorun` runtime setting is `manual` vs `auto`.
- **Stable identity**: Pluto gives every cell a UUID so outputs and state survive edits. markdown-rt uses ids for named fences and a content hash for unnamed ones; the hash loses identity on edit, which is acceptable because the output is recomputed, but it means anything with state (a map's pan, a running animation) should be in a named fence.

Negative

- **Marker noise.** `# ╔═╡ 8f3a…` lines and a cell-order block at the end of the file make Pluto files hard to edit by hand. Pragmas on the fence line are the least noisy place available in Markdown; a separate order table is exactly what to avoid.
- **Language-specific reactivity** (parsing Julia or Python for variable use) does not generalise. Observed reads through `mrt.get`/`data` do.

### 3.5 Livebook

Positive

- **Markdown file, code fences, metadata in HTML comments.** Closest existing format to markdown-rt in file shape.
- **Stale marks.** When a cell's dependency changes and the notebook is not in auto-reevaluate mode, dependents get a yellow "stale" badge until rerun. This is what `manual` mode should look like: not "nothing happened", but "these three cells are out of date". Adopt.
- **Branching sections** fork the runtime so a slow experiment does not block the main flow. Out of scope for v1, but it is the right answer if timeouts ever prove too blunt.
- **Secrets live in the hub, not the file.** The equivalent rule for markdown-rt: data a cell needs is in a fence, credentials never are, and a cell cannot reach the host's storage.

Negative

- **Optional stored outputs** in `<!-- livebook:{"output":true} -->` comments reintroduce the stale-output problem for the files that use it. `out` is the markdown-rt alternative: if a result belongs in the file, write it into a fence as content, not as an annotated cache.
- **Metadata in HTML comments** is invisible, which was the goal, but it also means the author cannot see what a cell's settings are without the tool. Pragmas are visible on purpose.

### 3.6 MATLAB Live Scripts, Maple, Hex, Zeppelin, Excel

- **MATLAB live controls** bind a slider to a numeric literal *in the source*: drag it and the number in the code changes. That is write-back to source as a first-class UI, the precedent for `mrt.set` from the user's side. The `.mlx` zipped-XML container is the negative lesson, again.
- **Maple document mode** hides inputs and shows typeset results, with a toggle. This is `hidden` plus a presentation mode, and it is the right default for template cells.
- **Hex** draws the dependency DAG and lets you click a node to run it and its dependents. A "graph view" of `in`/observed dependencies is a cheap, valuable debugging aid for a reactive document.
- **Zeppelin dynamic forms** put `${name=default}` templating directly in paragraph text. The `${…}` interpolation in `md run` is the same instinct; Zeppelin's is a custom mini-language, markdown-rt's is JavaScript.
- **Excel** is the most-used reactive document ever built. It got three things right that notebooks later rediscovered: recalculation is always by dependency, a cell has exactly one value, and circular references are *allowed* under an iteration cap (default 100) rather than forbidden. It got one thing wrong that every A1 user has felt: positional addressing breaks when a row is inserted, which is why named ranges exist. markdown-rt's round cap and id-only addressing are the Excel lessons applied.

---

## 4. Cross-vocabulary: the same ideas under different names

Evidence that the pragma table is complete enough, and a lookup for anyone arriving from another tool.

| Concept | markdown-rt | Wolfram cell option | knitr / Quarto | Org Babel | Jupyter | Marimo / Pluto |
|---|---|---|---|---|---|---|
| this block executes | `run` | `Evaluatable->True` | `eval: true` | any `src` block | code cell | cell |
| parameters | `run(args)` | — | params (Quarto `params:`) | `:var` | papermill `parameters` tag | function params |
| run on open / first | `auto` | `InitializationCell->True` | — | — | — | `autorun` |
| run only on request | `manual` | `Evaluatable->False` + manual | `eval: false` | — | — | `lazy` |
| hide source, show result | `hidden` | `CellOpen->False`, hidden styles | `echo: false` | `:exports results` | `hide-input` tag | hide code |
| run, show nothing | `silent` *(proposed)* | — | `include: false` | `:results none` / `:exports none` | — | — |
| fold source | `collapsed` | `CellOpen->False` | `code-fold: true` | — | `source_hidden` | — |
| stable name | `#id` | `CellTags`, `CellLabel` | chunk label | `#+NAME:` | cell id (4.5) | function name / UUID |
| declared inputs | `in(a, b)` | — | `dependson` (cache) | `:var x=name` | — | params / free variables |
| result to a named place | `out(id)` | — | — | `:results replace` to a named block | — | — |
| append instead of replace | `out(id, append)` *(proposed)* | — | — | `:results append` | — | — |
| scripts may not write | `write=user` | — | — | — | — | — |
| editor read-only | `write=script` / `write=none` | `Editable->False` | — | — | `editable: false` metadata | — |
| time limit | `timeout(ms)` | `TimeConstrained` | — | — | — | — |
| caption | `title("…")` | cell label | `fig-cap` | `#+CAPTION:` | — | — |
| trusted to execute | host policy, remembered per document | `$TrustedPath`, dialog | — | `org-confirm-babel-evaluate` | notebook signature | — |
| iteration cap for cycles | 8 rounds per tick | — | — | — | — | — (cycles forbidden) |

Two gaps surfaced by the table and now proposed for the spec: **`silent`** (knitr's `include: false`, a cell that exists only for its `set` side effects and needs no slot) and **`out(id, append)`** (Org's `:results append`, the natural shape for a watch-mode log that a cell grows rather than replaces).

---

## 5. Summary of the lessons

Take

1. Plain text file that is valid in its base format without the tool. (Pluto, Marimo, Livebook, Observable Framework.)
2. Outputs out of the file; explicit write-back when a result belongs in it. (Pluto, Marimo; Org's named results.)
3. Named, not positional, addressing. (Excel named ranges, nbformat cell ids, Pluto UUIDs.)
4. Re-run by dependency in a defined order; document order as the readable tiebreak. (Observable, Excel, Marimo.)
5. Stale marks when not auto-running. (Livebook.)
6. Trust is per document, remembered, earned by the user's action; a host ceiling the document cannot raise. (Jupyter signatures, Wolfram `$TrustedPath`.)
7. A small complete vocabulary of per-cell options, visible in the source. (Wolfram cell options, knitr chunk options.)
8. Cells as functions with arguments. (papermill, Marimo.)
9. Cycles allowed under a cap, not forbidden. (Excel.)
10. The runtime as a library separate from the editor. (Observable Runtime.)
11. Every output has a plain-text reading. (Jupyter MIME bundles.)

Avoid

1. Outputs cached in the file. (Jupyter, Wolfram, MATLAB, Livebook optional.)
2. Machine-written file formats. (`.ipynb`, `.nb`, `.mlx`, `.mw`.)
3. Arbitrary execution order with shared mutable state. (Jupyter, Wolfram, Zeppelin.)
4. History-position references. (`%`, `In[n]`, `Out[n]`.)
5. Language-specific dependency inference. (Observable, Pluto, Marimo.)
6. Invisible metadata the author cannot see in the source. (Livebook comments, Jupyter cell metadata.)
7. Document order that does not matter. (Observable notebooks.)
8. Widget state with no defined home. (ipywidgets.)
9. Marker noise and separate order tables. (Pluto.)
10. Required kernels or platforms for the document to mean anything. (Wolfram, Observable notebooks, Hex.)
