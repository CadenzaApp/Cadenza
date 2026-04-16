//! This file is a thin wrapper around the external OpenAI API.
//! - Holds API config
//!	- Sends requests
//!	- Receives structured responses
//! - Translates API errors into your backend errors