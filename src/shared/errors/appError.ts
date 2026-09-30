interface errorType {
  statusCode: number;
  status: string;
  isOperational: boolean;
}

export default class AppError extends Error implements errorType {
  statusCode: number;
  status: string;
  isOperational: boolean;

  // Creates an operational error with an HTTP status code and fail/error status.
  constructor(message: string, statusCode: number) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}
