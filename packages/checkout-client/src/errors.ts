export class CheckoutServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "CheckoutServiceError";
  }
}

export class CheckoutServiceUnreachableError extends Error {
  constructor(
    message: string,
    override readonly cause: unknown,
  ) {
    super(message);
    this.name = "CheckoutServiceUnreachableError";
  }
}

export class CheckoutServiceInvalidResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "CheckoutServiceInvalidResponseError";
  }
}
