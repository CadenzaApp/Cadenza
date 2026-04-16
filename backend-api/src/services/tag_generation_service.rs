//! This file is the main layer and logic for the tag_generation pipeline.
//!	accept validated song inputs
//!	batch them if needed
//!	build the request payload for the LLM client
//!	call the OpenAI client
//!	post-process the returned tags
//!	return clean tag suggestions back to the route