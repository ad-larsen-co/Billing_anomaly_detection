from __future__ import annotations


class AppError(Exception):
    """Base application error."""

    def __init__(self, message: str, code: str = "app_error") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


class ConfigurationError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(message, code="configuration_error")


class ExternalServiceError(AppError):
    def __init__(self, message: str, service: str = "external") -> None:
        super().__init__(message, code=f"external_{service}")


class ValidationError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(message, code="validation_error")


class DatabaseError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(message, code="database_error")
