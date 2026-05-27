// VMOS Cloud OpenAPI client.
//
// Reference docs:
//   - https://cloud.vmoscloud.com/vmoscloud/doc/en/server/OpenAPI.html
//   - https://cloud.vmoscloud.com/vmoscloud/doc/en/server/example.html
//
// Host: https://api.vmoscloud.com  (backend is openapi-hk.armcloud.net)
//
// Auth: Volcano-Engine-style HMAC-SHA256 v4 (service = "armcloud-paas")
// All API calls are POST with JSON body. All "pad" parameters are arrays
// (`padCodes`), even when targeting a single device.

import crypto from "crypto";

const DEFAULT_HOST = "api.vmoscloud.com";
const CONTENT_TYPE = "application/json;charset=UTF-8";
const SERVICE = "armcloud-paas";
const ALGORITHM = "HMAC-SHA256";
const SIGNED_HEADERS = "content-type;host;x-content-sha256;x-date";

// Task statuses returned by fileTaskDetail / padTaskDetail
export const TASK_STATUS = {
  ALL_FAILED: -1,
  PARTIAL_FAILED: -2,
  CANCELED: -3,
  TIMEOUT: -4,
  PENDING: 1,
  EXECUTING: 2,
  COMPLETED: 3,
  QUEUED: 9,
} as const;

export interface VmosCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Host without protocol. Defaults to `api.vmoscloud.com`. */
  host?: string;
}

export interface VmosResponse<T = unknown> {
  code: number;
  msg?: string;
  message?: string;
  data?: T;
  ts?: number;
  traceId?: string;
}

export interface VmosUserPad {
  padCode: string;
  displayName: string;
  configCode: string;
  goodConfigName?: string;
  androidVersion?: string;
  countryCode?: string;
  armCountryMsg?: string;
  /** 1 = normal */
  status?: number;
  cvmStatus?: number;
  bootTime?: number;
  equipmentId?: number;
}

export interface VmosTaskResult {
  taskId: number;
  padCode: string;
  /** 0 = offline; 1 = online */
  vmStatus: number;
}

export interface VmosScreenshotResult {
  padCode: string;
  accessUrl?: string;
  url?: string;
  taskId?: number;
  expireAt?: number;
  success?: boolean;
  reason?: string | null;
}

export interface VmosInstalledApp {
  packageName: string;
  appName?: string;
  versionName?: string;
  versionCode?: string;
  /** 0 = installed */
  appState?: number;
}

export interface VmosListInstalledAppResult {
  padCode: string;
  apps: VmosInstalledApp[];
}

export interface VmosTaskDetail {
  taskId: number;
  padCode?: string;
  taskStatus: number;
  endTime?: number | null;
  taskContent?: string;
  taskResult?: string;
  errorMsg?: string;
  fileName?: string;
}

export class VmosCloudError extends Error {
  constructor(
    message: string,
    public code?: number,
    public httpStatus?: number,
    public body?: string,
  ) {
    super(message);
    this.name = "VmosCloudError";
  }
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, msg: string): Buffer {
  return crypto.createHmac("sha256", key).update(msg, "utf8").digest();
}

function xDateNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export class VmosCloudClient {
  private readonly host: string;
  constructor(private readonly creds: VmosCredentials) {
    this.host = (creds.host ?? DEFAULT_HOST).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }

  private buildHeaders(body: string): Record<string, string> {
    const xDate = xDateNow();
    const shortXDate = xDate.substring(0, 8);
    const credentialScope = `${shortXDate}/${SERVICE}/request`;

    const canonical = [
      `host:${this.host}`,
      `x-date:${xDate}`,
      `content-type:${CONTENT_TYPE}`,
      `signedHeaders:${SIGNED_HEADERS}`,
      `x-content-sha256:${sha256Hex(body)}`,
    ].join("\n");

    const stringToSign = [ALGORITHM, xDate, credentialScope, sha256Hex(canonical)].join("\n");

    const kDate = hmacSha256(this.creds.secretAccessKey, shortXDate);
    const kService = hmacSha256(kDate, SERVICE);
    const signKey = hmacSha256(kService, "request");
    const signature = crypto
      .createHmac("sha256", signKey)
      .update(stringToSign, "utf8")
      .digest("hex");

    return {
      "x-date": xDate,
      "x-host": this.host,
      authorization: `${ALGORITHM} Credential=${this.creds.accessKeyId}/${credentialScope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`,
      "content-type": CONTENT_TYPE,
    };
  }

  async post<T = unknown>(path: string, payload: Record<string, unknown> = {}): Promise<T> {
    const body = JSON.stringify(payload);
    const url = `https://${this.host}${path}`;
    const res = await fetch(url, { method: "POST", headers: this.buildHeaders(body), body });
    const text = await res.text();
    if (!res.ok) {
      throw new VmosCloudError(
        `VMOS HTTP ${res.status} on ${path}`,
        undefined,
        res.status,
        text.slice(0, 500),
      );
    }
    let json: VmosResponse<T>;
    try {
      json = JSON.parse(text) as VmosResponse<T>;
    } catch {
      throw new VmosCloudError(
        `VMOS returned non-JSON for ${path}`,
        undefined,
        res.status,
        text.slice(0, 500),
      );
    }
    if (json.code !== undefined && json.code !== 0 && json.code !== 200) {
      throw new VmosCloudError(
        `VMOS API code ${json.code} on ${path}: ${json.msg ?? json.message ?? ""}`,
        json.code,
        res.status,
        text.slice(0, 500),
      );
    }
    return (json.data ?? (json as unknown)) as T;
  }

  // -------------------- Devices --------------------

  /** List all pads owned by this account. Doubles as an auth check. */
  async listUserPads(): Promise<VmosUserPad[]> {
    return this.post<VmosUserPad[]>("/vcpcloud/api/padApi/userPadList", {});
  }

  // -------------------- App lifecycle --------------------

  /**
   * Push an APK to one or more pads and (optionally) install it.
   * VMOS exposes installation as part of the "upload file" endpoint.
   * Pass `autoInstall: 1` to install after upload (default in this method).
   */
  async installApp(
    padCodes: string[],
    apkUrl: string,
    opts: {
      packageName?: string;
      fileName?: string;
      md5?: string;
      autoInstall?: 0 | 1;
      isAuthorization?: boolean;
    } = {},
  ): Promise<VmosTaskResult[]> {
    return this.post<VmosTaskResult[]>("/vcpcloud/api/padApi/uploadFileV3", {
      padCodes,
      url: apkUrl,
      autoInstall: opts.autoInstall ?? 1,
      packageName: opts.packageName,
      fileName: opts.fileName,
      md5: opts.md5,
      isAuthorization: opts.isAuthorization ?? false,
    });
  }

  async startApp(padCodes: string[], packageName: string): Promise<VmosTaskResult[]> {
    return this.post<VmosTaskResult[]>("/vcpcloud/api/padApi/startApp", {
      padCodes,
      pkgName: packageName,
    });
  }

  async stopApp(padCodes: string[], packageName: string): Promise<VmosTaskResult[]> {
    return this.post<VmosTaskResult[]>("/vcpcloud/api/padApi/stopApp", {
      padCodes,
      pkgName: packageName,
    });
  }

  async restartApp(padCodes: string[], packageName: string): Promise<VmosTaskResult[]> {
    return this.post<VmosTaskResult[]>("/vcpcloud/api/padApi/restartApp", {
      padCodes,
      pkgName: packageName,
    });
  }

  /** ADB-style uninstall via `asyncCmd`. VMOS has no dedicated uninstall API. */
  async uninstallApp(padCodes: string[], packageName: string): Promise<VmosTaskResult[]> {
    return this.asyncCmd(padCodes, `pm uninstall ${packageName}`);
  }

  async listInstalledApp(padCodes: string[]): Promise<VmosListInstalledAppResult[]> {
    return this.post<VmosListInstalledAppResult[]>(
      "/vcpcloud/api/padApi/listInstalledApp",
      { padCodes },
    );
  }

  // -------------------- Screen capture --------------------

  /**
   * Trigger a fresh screenshot. Some response variants include `accessUrl`
   * directly; others return only `taskId` and you must poll with
   * `getLongGenerateUrl` to fetch the rendered URL.
   */
  async screenshot(
    padCodes: string[],
    opts: {
      rotation?: 0 | 1;
      definition?: number;
      resolutionWidth?: number;
      resolutionHeight?: number;
      broadcast?: boolean;
    } = {},
  ): Promise<VmosScreenshotResult[]> {
    return this.post<VmosScreenshotResult[]>("/vcpcloud/api/padApi/screenshot", {
      padCodes,
      rotation: opts.rotation ?? 0,
      definition: opts.definition,
      resolutionWidth: opts.resolutionWidth,
      resolutionHeight: opts.resolutionHeight,
      broadcast: opts.broadcast ?? false,
    });
  }

  /** Returns persistent preview URLs (refresh to get latest frame). */
  async getLongGenerateUrl(padCodes: string[]): Promise<VmosScreenshotResult[]> {
    return this.post<VmosScreenshotResult[]>("/vcpcloud/api/padApi/getLongGenerateUrl", {
      padCodes,
    });
  }

  // -------------------- ADB / shell --------------------

  async asyncCmd(padCodes: string[], scriptContent: string): Promise<VmosTaskResult[]> {
    return this.post<VmosTaskResult[]>("/vcpcloud/api/padApi/asyncCmd", {
      padCodes,
      scriptContent,
    });
  }

  // -------------------- Touch --------------------

  async simulateTap(
    padCode: string,
    x: number,
    y: number,
    width = 1080,
    height = 1920,
  ): Promise<VmosTaskResult[]> {
    return this.post<VmosTaskResult[]>("/vcpcloud/api/padApi/simulateTouch", {
      padCodes: [padCode],
      width,
      height,
      pointCount: 1,
      positions: [
        { actionType: 0, x, y, nextPositionWaitTime: 30 },
        { actionType: 1, x, y },
      ],
    });
  }

  async simulateSwipe(
    padCode: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width = 1080,
    height = 1920,
  ): Promise<VmosTaskResult[]> {
    return this.post<VmosTaskResult[]>("/vcpcloud/api/padApi/simulateTouch", {
      padCodes: [padCode],
      width,
      height,
      pointCount: 1,
      positions: [
        { actionType: 0, x: x1, y: y1, nextPositionWaitTime: 30, touchType: "gestureSwipe" },
        { actionType: 2, x: x2, y: y2, nextPositionWaitTime: 30, touchType: "gestureSwipe" },
        { actionType: 1, x: x2, y: y2, touchType: "gestureSwipe" },
      ],
    });
  }

  // -------------------- Task polling --------------------

  async getFileTaskDetail(taskIds: Array<number | string>): Promise<VmosTaskDetail[]> {
    return this.post<VmosTaskDetail[]>("/vcpcloud/api/padApi/fileTaskDetail", { taskIds });
  }

  async getPadTaskDetail(taskIds: Array<number | string>): Promise<VmosTaskDetail[]> {
    return this.post<VmosTaskDetail[]>("/vcpcloud/api/padApi/padTaskDetail", { taskIds });
  }

  /**
   * Block until a file task (install/upload) finishes successfully, or throw.
   */
  async waitForFileTask(
    taskId: number | string,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
    const pollIntervalMs = opts.pollIntervalMs ?? 3000;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const details = await this.getFileTaskDetail([taskId]);
      const t = details[0];
      if (t) {
        if (t.taskStatus === TASK_STATUS.COMPLETED) return;
        if (
          t.taskStatus === TASK_STATUS.ALL_FAILED ||
          t.taskStatus === TASK_STATUS.PARTIAL_FAILED ||
          t.taskStatus === TASK_STATUS.CANCELED ||
          t.taskStatus === TASK_STATUS.TIMEOUT
        ) {
          throw new VmosCloudError(
            `VMOS file task ${taskId} failed (status ${t.taskStatus}): ${t.errorMsg ?? ""}`,
            t.taskStatus,
          );
        }
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new VmosCloudError(`VMOS file task ${taskId} timed out after ${timeoutMs}ms`);
  }
}

export function vmosClientFromEnv(): VmosCloudClient | null {
  const accessKeyId = process.env.VMOSCLOUD_ACCESS_KEY_ID;
  const secretAccessKey = process.env.VMOSCLOUD_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return new VmosCloudClient({
    accessKeyId,
    secretAccessKey,
    host: process.env.VMOSCLOUD_HOST,
  });
}
