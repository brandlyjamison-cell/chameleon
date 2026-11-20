import type {
  CaptureKind,
  EngineCapture,
  ResolvedTemplate,
  ResolveInput,
  ServiceTypeCode,
} from "@chameleon/contracts";
import type { RenderTemplate } from "@chameleon/skeleton";

/**
 * The seam between "a service type exists" and "a request is served". Every
 * service_type implements this and nothing in the shared route may branch on the
 * type instead (INV-ARCH-04).
 */
export interface Engine {
  readonly code: ServiceTypeCode;
  /** What this engine may ever store. chameleon: ['credential'] only (INV-CAP-03). */
  readonly captureKinds: readonly CaptureKind[];
  readonly defaultKind: CaptureKind;
  resolve(input: ResolveInput): Promise<ResolvedTemplate>;
  render(template: ResolvedTemplate): Promise<string>;
  /** The engine decides `kind`; the route copies it. */
  parseCapture(
    form: Record<string, string>,
    prior: { username: string } | null,
  ): EngineCapture;
  /** The real destination after capture. Server-built, never tenant-supplied. */
  redirectTarget(template: ResolvedTemplate): string;
  onConsumed?(captureId: string): Promise<void>;
}

export type { RenderTemplate };
