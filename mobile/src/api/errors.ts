export class TrackerRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "TrackerRequestError";
    this.status = status;
  }
}

export class TrackerAuthError extends TrackerRequestError {
  constructor(message = "Invalid tracker token", status = 401) {
    super(message, status);
    this.name = "TrackerAuthError";
  }
}

export class TrackerProtocolError extends TrackerRequestError {
  constructor(message: string) {
    super(message);
    this.name = "TrackerProtocolError";
  }
}

export class TrackerTimeoutError extends TrackerRequestError {
  constructor(message = "Tracker request timed out") {
    super(message);
    this.name = "TrackerTimeoutError";
  }
}
