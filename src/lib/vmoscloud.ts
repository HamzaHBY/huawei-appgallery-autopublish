// VMOS Cloud OpenAPI client.
//
// Reference docs: https://cloud.vmoscloud.com/openapi/document
// Host: https://api.vmoscloud.com
//
// Auth (HMAC-SHA256):
//   raw_string = Timestamp + AccessKeyId + RequestBody
//   signature  = Base64( HMAC_SHA256(raw_string, SecretAccessKey) )
//   Headers:
//     Authorization: <signature>
//     Timestamp: <epoch_seconds>
//     AccessId: <access_key_id>
//     Content-Type: application/json
//
// Useful endpoints for screenshot capture:
//   POST /vsphone/api/padApi/installApp     { padCode, apkUrl } -> { taskId }
//   POST /vsphone/api/padApi/startApp       { padCode, packageName }
//   POST /vsphone/api/padApi/stopApp        { padCode, packageName }
//   POST /vsphone/api/padApi/asyncCmd       { padCodes:[], cmd } -> { taskId }  (ADB shell)
//   POST /vsphone/api/padApi/screenshot     { padCode, savePath } -> saves to instance
//   POST /vsphone/api/padApi/getLongGenerateUrl { padCode } -> { previewUrl }
//   POST /vsphone/api/padApi/fileTaskDetail { taskId } -> { status, ... }
//   POST /vsphone/api/padApi/padTaskDetail  { taskId } -> { status, ... }

import crypto from "crypto";

const DEFAULT_BASE_URL = "https://api.vmoscloud.com";

export interface VmosCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  baseUrl?: string;
}

export interface VmosResponse<T = unknown> {
  code: number;
  msg?: string;
  message?: string;
  data?: T;
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

export class VmosCloudClient {
  private readonly baseUrl: string;
  constructor(private readonly creds: VmosCredentials) {
    this.baseUrl = (creds.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private sign(body: string): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const raw = timestamp + this.creds.accessKeyId + body;
    const signature = crypto
      .createHmac("sha256", this.creds.secretAccessKey)
      .update(raw, "utf8")
      .digest("base64");
    return {
      Authorization: signature,
      Timestamp: timestamp,
      AccessId: this.creds.accessKeyId,
      "Content-Type": "application/json",
    };
  }

  async post<T = unknown>(path: string, payload: Record<string, unknown>): Promise<T> {
    const body = JSON.stringify(payload);
    const headers = this.sign(body);
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, { method: "POST", headers, body });
    const text = await res.text();
    if (!res.ok) {
      throw new VmosCloudError(
        `VMOS request failed ${res.status} ${path}`,
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
        `VMOS error ${json.code} on ${path}: ${json.msg ?? json.message ?? ""}`,
        json.code,
        res.status,
        text.slice(0, 500),
      );
    }
    return (json.data ?? (json as unknown)) as T;
  }

  // ---------------- Apps ----------------

  async installApp(padCode: string, apkUrl: string): Promise<string> {
    const data = await this.post<{ taskId?: string; taskID?: string }>(
      "/vsphone/api/padApi/installApp",
      { padCode, apkUrl },
    );
    const taskId = data.taskId ?? data.taskID;
    if (!taskId) {
      throw new VmosCloudError("installApp: no taskId in response");
    }
    return taskId;
  }

  async startApp(padCode: string, packageName: string): Promise<void> {
    await this.post("/vsphone/api/padApi/startApp", { padCode, packageName });
  }

  async stopApp(padCode: string, packageName: string): Promise<void> {
    await this.post("/vsphone/api/padApi/stopApp", { padCode, packageName });
  }

  async uninstallApp(padCode: string, packageName: string): Promise<string> {
    // VMOS Cloud doesn't expose a direct uninstallApp endpoint, so we shell
    // out via asyncCmd. Returns a taskId you can poll if you want.
    const data = await this.post<{ taskId?: string; taskID?: string }>(
      "/vsphone/api/padApi/asyncCmd",
      { padCodes: [padCode], cmd: `pm uninstall ${packageName}` },
    );
    return data.taskId ?? data.taskID ?? "";
  }

  // ---------------- Interaction ----------------

  async screenshot(padCode: string, savePath = "/sdcard/devin-screenshot.png"): Promise<void> {
    await this.post("/vsphone/api/padApi/screenshot", { padCode, savePath });
  }

  async getPreviewUrl(padCode: string): Promise<string> {
    const data = await this.post<{ previewUrl?: string; url?: string }>(
      "/vsphone/api/padApi/getLongGenerateUrl",
      { padCode },
    );
    const url = data.previewUrl ?? data.url ?? "";
    if (!url) throw new VmosCloudError("getPreviewUrl: empty response");
    return url;
  }

  async tap(padCode: string, x: number, y: number): Promise<void> {
    await this.post("/vsphone/api/padApi/simulateTouch", {
      padCode,
      events: [
        { action: "down", x, y },
        { action: "up", x, y },
      ],
    });
  }

  async swipe(padCode: string, x1: number, y1: number, x2: number, y2: number): Promise<void> {
    await this.post("/vsphone/api/padApi/simulateTouch", {
      padCode,
      events: [
        { action: "down", x: x1, y: y1 },
        { action: "move", x: x2, y: y2 },
        { action: "up", x: x2, y: y2 },
      ],
    });
  }

  // ---------------- Tasks ----------------

  async getFileTaskDetail(
    taskId: string,
  ): Promise<{ status: string; progress?: number; errorMsg?: string }> {
    return this.post("/vsphone/api/padApi/fileTaskDetail", { taskId });
  }

  async getPadTaskDetail(
    taskId: string,
  ): Promise<{ status: string; progress?: number; errorMsg?: string }> {
    return this.post("/vsphone/api/padApi/padTaskDetail", { taskId });
  }

  async waitForFileTask(
    taskId: string,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
    const pollIntervalMs = opts.pollIntervalMs ?? 3000;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const detail = await this.getFileTaskDetail(taskId);
      const status = (detail.status ?? "").toLowerCase();
      if (status === "completed" || status === "success" || status === "succeeded") return;
      if (status === "failed" || status === "error") {
        throw new VmosCloudError(
          `File task ${taskId} failed: ${detail.errorMsg ?? "unknown error"}`,
        );
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new VmosCloudError(`File task ${taskId} timed out after ${timeoutMs}ms`);
  }
}

export function vmosClientFromEnv(): VmosCloudClient | null {
  const accessKeyId = process.env.VMOSCLOUD_ACCESS_KEY_ID;
  const secretAccessKey = process.env.VMOSCLOUD_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return new VmosCloudClient({
    accessKeyId,
    secretAccessKey,
    baseUrl: process.env.VMOSCLOUD_BASE_URL,
  });
}
