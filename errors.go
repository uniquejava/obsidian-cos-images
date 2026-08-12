package main

import "errors"

// ErrNotImplemented marks stub service methods in the project skeleton.
var ErrNotImplemented = errors.New("not implemented: see docs/REQUIREMENTS.md")

// ErrMissingCredentials means COS SecretId/SecretKey are not configured.
var ErrMissingCredentials = errors.New("missing COS credentials")
