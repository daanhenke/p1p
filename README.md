# @p1p — Persona 1 English Retranslation Toolkit

A TypeScript monorepo for building an English-retranslated **Megami Ibunroku Persona** (PlayStation)
disc from your own US + Japanese copies. It contains the romhacking framework (disc/format codecs,
an XML‑patch system, a disc builder), the authored translation + gameplay patches, a command‑line
tool, and an in‑browser **setup wizard** that does the whole build client‑side — the disc images
never leave your machine.

> **Legal:** no copyrighted game data ships here. You supply your own disc images. Disc files dropped
> under `packages/persona1/assets/disk/` are git‑ignored and never committed.

---

## Repository layout

This is a [pnpm](https://pnpm.io) workspace. Every library is published under the `@p1p/*` scope.

| Package | What it is |
|---|---|
| [`@p1p/core`](packages/core) | Game‑agnostic core: the `Datatype` codec abstraction, the layered **patch** system, the compiled `.bin` pack format, the XML harness, the build pipeline. |
| [`@p1p/ps1`](packages/ps1) | PlayStation 1 formats: ISO‑9660 `.bin` disc (EDC/ECC rebuild), TIM images, the MIPS assembler, and the anchored **code‑patch** datatype. |
| [`@p1p/atlus`](packages/atlus) | The Atlus sector‑table archive container (`E*.BIN` / `MES.BIN`). |
| [`@p1p/cli`](packages/cli) | The generic `p1p` CLI engine (`dump` / `compile` / `build`). |
| [`persona1`](packages/persona1) | The Persona 1 build **profile**, all format codecs (text, script VM, datatypes), the authored **patches**, the **wizard** flavour, and the `persona1` CLI binary. |
| [`@p1p/wizard`](packages/wizard) | The game‑agnostic, InstallShield‑style **setup wizard** (Vue). A consumer supplies a `WizardConfig` to brand and wire its build. |

```
packages/
  core/ ps1/ atlus/ cli/ wizard/
  persona1/
    src/            # profile.ts (the `persona1` profile) + datatype codecs
    patches/        # authored patch sources (XML) — see "Authoring patches"
    assets/         # banner/desktop art + music (single source of truth); disk/ is git-ignored
    wizard/         # the Persona 1 wizard app (config + in-browser build + Containerfile)
```

---

## Quick start

```bash
pnpm install

# typecheck / lint / test the whole workspace
pnpm typecheck
pnpm lint
pnpm test

# run the Persona 1 setup wizard locally (compiles patch packs first, then serves on :5175)
pnpm --filter persona1 wizard:dev
```

Open the dev server, drop in your US + Japanese `.bin` images, pick any optional tweaks, and it builds
a patched disc in the browser.

---

## The setup wizard

The wizard walks the user through: welcome → release notes → disc upload (with **hash verification**)
→ optional patches (with **per‑patch settings**) → destination → in‑browser build.

```bash
pnpm --filter persona1 wizard:dev        # dev server (HMR)
pnpm --filter persona1 wizard:packs      # just (re)compile patch packs + stage assets into public/
pnpm --filter persona1 wizard:build      # production bundle → packages/persona1/wizard/dist
pnpm --filter persona1 wizard:typecheck  # vue-tsc
```

`wizard:packs` compiles every patch directory to `public/patches/<id>.bin` and stages the runtime
assets (`/banner.jpg`, `/background.jpg`, `/ost/**`) from `packages/persona1/assets` into `public/`,
so they work in both dev and the production build.

### Branding & config

The Persona 1 wizard is just a [`WizardConfig`](packages/wizard/src/types.ts) object —
[`packages/persona1/wizard/config.ts`](packages/persona1/wizard/config.ts). It sets the title,
welcome copy, banner/desktop images, background music, the ROM inputs (with known‑good hashes), the
optional patches, the changelog, and the in‑browser `build` function. The generic `@p1p/wizard`
package knows nothing about Persona — it only renders the config.

### ROM hash verification

Each ROM input may declare accepted SHA‑1 digests:

```ts
{ id: "us", label: "Persona (USA)", hint: "Persona (USA).bin",
  hashes: ["3e7d8019a3191a29a48bb9d574cf05b1bc998c06"] }
```

On upload the wizard computes the file's SHA‑1 and shows **✔ verified** or **⚠ unrecognized image**.
A mismatch warns but never blocks (legitimate dumps vary).

### Analytics (optional)

Privacy‑friendly, self‑hosted [Umami](https://umami.is). Off unless both env vars are set at build
time; one `build` event (version, commit, enabled patches + settings) is sent on a successful build.

```bash
VITE_UMAMI_SRC=/stats/script.js VITE_UMAMI_ID=<website-id> \
VITE_WIZARD_VERSION=0.1.0 VITE_GIT_COMMIT=$(git rev-parse --short HEAD) \
  pnpm --filter persona1 wizard:build
```

---

## The CLI (`persona1`)

The `persona1` package exposes the `persona1` CLI (the `p1p` engine pre‑wired with the P1 profile) via
a package script — run it with `pnpm --filter persona1 persona1 <command>`:

```bash
# Full extract: every datatype's XML sources + font atlas + TIM images
pnpm --filter persona1 persona1 dump --disc "Persona (USA).bin" --out sources

# Compile a patch directory → a distributable .bin pack
pnpm --filter persona1 persona1 compile packages/persona1/patches/faster-text --out faster-text.bin

# Layer patch packs over a disc and write the result (--jp supplies the scene-text source disc)
pnpm --filter persona1 persona1 build \
  --disc "Persona (USA).bin" --jp "Persona (Japan).bin" \
  --patches persona1-en.bin,faster-text.bin --out "Persona [EN].bin"
```

---

## Authoring patches

A **patch** is a self‑contained feature (the base translation, an optional tweak, or a third‑party
mod): a manifest plus a flat set of *overrides* across any datatypes. Patches are layered at build
time in priority order; the base game record is the starting point and each enabled patch merges on
top.

### Directory structure

A patch is a directory with a `patch.xml` manifest and per‑datatype XML sources grouped into folders
named for the *thing* they edit:

```
packages/persona1/patches/persona1-en/
  patch.xml                 # manifest
  names/    demons.xml personas.xml
  skills.xml
  dungeon/  d18.xml …
  battle/   dialogue.xml
  overworld/ dialogue.xml
  scenes/   e0/0.xml e0/1.xml …    # one file per scene message block
```

The manifest declares id, target game, version, and load order:

```xml
<patch id="persona1-en" version="0.1.0" game="persona1" priority="0">
  <name>Persona 1 English Retranslation</name>
  <description>Base English retranslation — scene text, names, dialogue, and all string tables.</description>
</patch>
```

The fastest way to start a new translation/mod is `persona1 dump` (above): it writes the full XML tree;
edit the records you care about, delete the rest, and that directory *is* your patch.

### Code patches (with settings)

Compiled overlay code (movement speed, EXP, encounter rate) has no structure to follow, so it uses
the one anchored‑byte‑scan datatype. A `<site>` anchors on a unique byte pattern (`??`/`**` =
wildcard) in a target file and writes a little‑endian `value` (or an `asm=` MIPS instruction) at an
offset within the match.

A code‑patch may also declare **settings** — user‑tunable knobs the wizard renders as dropdowns. A
site bound to a setting carries a `<case>` per option; the chosen option is resolved at build time
(and the settings travel *inside* the compiled `.bin`, so the wizard is the only source of truth):

```xml
<code-patch id="exp-multiplier" name="EXP multiplier (battle)">
  <setting id="exp-multiplier" label="EXP multiplier" default="x2">
    <option value="x2" label="2×"/>
    <option value="x4" label="4×"/>
    <option value="x8" label="8×"/>
  </setting>
  <site file="/BTLP.BIN" anchor="b0 73 10 8e 87 5b 00 0c …" offset="8" width="4" setting="exp-multiplier">
    <case option="x2" asm="sll $s0, $s0, 1"/>
    <case option="x4" asm="sll $s0, $s0, 2"/>
    <case option="x8" asm="sll $s0, $s0, 3"/>
  </site>
</code-patch>
```

For the wizard to surface a knob, the patch id must appear in the wizard config's `patches` list; its
settings are then hydrated from the compiled pack at load.

### Compiling

```bash
persona1 compile <patch-dir> --out <id>.bin     # one patch
pnpm --filter persona1 wizard:packs          # all patches under packages/persona1/patches/
```

---

## Container deployment

A [Containerfile](packages/persona1/wizard/Containerfile) builds a static nginx image of the wizard.
The build context is this repo root (so workspace deps resolve); `.containerignore` keeps installed
deps and copyrighted disc data out of the context.

```bash
podman build -f packages/persona1/wizard/Containerfile -t persona1-wizard \
  --build-arg VITE_UMAMI_SRC=/stats/script.js \
  --build-arg VITE_UMAMI_ID=<website-id> \
  --build-arg VITE_GIT_COMMIT=$(git rev-parse --short HEAD) .

podman run --rm -p 8080:80 persona1-wizard   # → http://localhost:8080
```

All build args are optional — with none, analytics is off and the version defaults to the changelog
head.

---

## Development

| Command | What it does |
|---|---|
| `pnpm build` | `tsc -b` across all packages |
| `pnpm typecheck` | type‑check the workspace + the wizard (`vue-tsc`) |
| `pnpm lint` | ESLint (flat config, `@stylistic`) |
| `pnpm test` | Vitest (unit + round‑trip; disc‑integration tests skip unless a disc is present) |

To run the disc‑integration tests, drop the real images under
`packages/persona1/assets/disk/psx_us/` and `…/psx_jp/` (git‑ignored).
