// Where raw bytes come from — a disc image, a loose folder, or an in-memory map. The rest of the
// pipeline reads through this so it's agnostic to the source (ported from port/Per1.Formats/AssetSource.cs).
// Paths are ISO-style ("/ADV/E0.BIN"), case-insensitive, version suffix (";1") stripped.

export interface AssetSource {
  readonly describe: string;
  has(path: string): boolean;
  tryRead(path: string): Uint8Array | undefined;
  read(path: string): Uint8Array;
  list(): string[];
  /**
   * The PRIMARY disc's bytes for a path, ignoring any multi-disc routing (and any layered edits).
   * For most sources this is just `tryRead`; for a routed/multi-disc source it returns the base disc's
   * version even when reads are routed elsewhere. Needed when a routed file's mirror (e.g. an EXE-embedded
   * sector table) lives on the primary disc, so the patch must match the primary's original, not the
   * routed one. Optional — callers fall back to `tryRead` when absent.
   */
  unrouted?(path: string): Uint8Array | undefined;
}

const norm = (p: string): string => "/" + p.replace(/\\/g, "/").replace(/^\/+/, "").split(";")[0].toUpperCase();

/** Asset source backed by an in-memory `{ path: bytes }` map (tests, the compiled pack, etc.). */
export class MemoryAssetSource implements AssetSource {
  private readonly files = new Map<string, Uint8Array>();
  constructor(files: Record<string, Uint8Array> = {}, readonly describe = "memory") {
    for (const [k, v] of Object.entries(files)) this.files.set(norm(k), v);
  }

  set(path: string, data: Uint8Array): void { this.files.set(norm(path), data); }
  has(path: string): boolean { return this.files.has(norm(path)); }
  tryRead(path: string): Uint8Array | undefined { return this.files.get(norm(path)); }
  read(path: string): Uint8Array {
    const d = this.tryRead(path);
    if (!d) throw new Error(`asset not found: ${path}`);
    return d;
  }

  list(): string[] { return [...this.files.keys()]; }
}

/**
 * Routes reads to a `secondary` source for a fixed set of ISO paths, falling back to `primary` for
 * everything else. Used for multi-disc builds (e.g. Persona 1: scene archives come from the JP disc,
 * the rest of the game from the US disc). `list()` reflects the primary (the disc being rebuilt).
 */
export class RoutingAssetSource implements AssetSource {
  private readonly routed: Set<string>;
  constructor(
    private readonly primary: AssetSource,
    private readonly secondary: AssetSource,
    routedPaths: Iterable<string>,
    readonly describe = `${primary.describe} + ${secondary.describe} (routed)`,
  ) {
    this.routed = new Set([...routedPaths].map(norm));
  }

  private srcFor(path: string): AssetSource {
    return this.routed.has(norm(path)) && this.secondary.has(path) ? this.secondary : this.primary;
  }

  has(path: string): boolean { return this.srcFor(path).has(path); }
  tryRead(path: string): Uint8Array | undefined { return this.srcFor(path).tryRead(path); }
  read(path: string): Uint8Array {
    const d = this.tryRead(path);
    if (!d) throw new Error(`asset not found: ${path}`);
    return d;
  }

  /** The base disc's version, ignoring routing — for files routed to the secondary whose primary-disc
   *  mirror still needs patching against the primary's original (e.g. the EXE-embedded sector tables). */
  unrouted(path: string): Uint8Array | undefined { return this.primary.tryRead(path); }

  list(): string[] { return this.primary.list(); }
}

/**
 * Reads from a `base` source but lets the build overlay edited files on top, so a datatype's
 * `apply` sees the changes a previous datatype made to the same host file (the build composes them).
 */
export class LayeredAssetSource implements AssetSource {
  private readonly overlay = new Map<string, Uint8Array>();
  constructor(private readonly base: AssetSource) {}

  get describe(): string { return `${this.base.describe} +${this.overlay.size} edits`; }
  put(path: string, data: Uint8Array): void { this.overlay.set(norm(path), data); }
  changedFiles(): Map<string, Uint8Array> { return new Map(this.overlay); }

  has(path: string): boolean { return this.overlay.has(norm(path)) || this.base.has(path); }
  tryRead(path: string): Uint8Array | undefined { return this.overlay.get(norm(path)) ?? this.base.tryRead(path); }
  read(path: string): Uint8Array {
    const d = this.tryRead(path);
    if (!d) throw new Error(`asset not found: ${path}`);
    return d;
  }

  /** Pristine primary-disc bytes (no overlay edits, no routing) — delegates to the base source. */
  unrouted(path: string): Uint8Array | undefined { return this.base.unrouted?.(path) ?? this.base.tryRead(path); }

  list(): string[] {
    const set = new Set(this.base.list());
    for (const k of this.overlay.keys()) set.add(k);
    return [...set];
  }
}
