export interface CourseConfig {
  course: string;
  attendanceId: number;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  publicUrl: string;
  allowedOrigin: string;
  trustProxy: boolean;
  databasePath: string;
  moodleBaseUrl: string;
  moodleToken: string;
  moodleTimeoutMs: number;
  adminPassword: string;
  authSecret: string;
  adminSessionSeconds: number;
  loginWindowSeconds: number;
  maxLoginAttempts: number;
  publicFailureWindowSeconds: number;
  maxPublicFailures: number;
  presentStatusAcronym: string;
  absentStatusAcronym: string;
  moodleTakenById: number | undefined;
  moodleStatusSet: number | undefined;
  courses: CourseConfig[];
  openSeconds: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export type JsonObject = Record<string, unknown>;

export interface MoodleGateway {
  getSessions(attendanceId: number): Promise<JsonObject[]>;
  getSession(sessionId: number): Promise<JsonObject>;
  updateUserStatus(payload: Record<string, number>): Promise<JsonObject>;
}

export interface Clock {
  nowSeconds(): number;
}
