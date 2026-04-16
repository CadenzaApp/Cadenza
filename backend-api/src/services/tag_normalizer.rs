//! This file is for cleanup after the LLM responds.
//!	- Trim tags
//! - Lowercase tags
//! - Dedupe tags
//! - Maybe map synonyms later
//! - Maybe filter banned/useless tags
//! This keeps cleanup logic out of the route and out of the OpenAI client.
