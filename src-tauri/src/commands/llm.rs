use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRequest {
    pub url: String,
    pub api_key: String,
    pub body: serde_json::Value,
    pub provider: String, // "openai-compatible" or "anthropic"
}

#[derive(Serialize)]
pub struct LlmResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

/// Proxy an LLM API call through the Rust backend.
/// This avoids CORS issues and keeps API keys out of the webview.
#[tauri::command]
pub async fn llm_chat(request: LlmRequest) -> Result<LlmResponse, String> {
    let client = reqwest::Client::new();

    let mut req = client.post(&request.url);

    // Set auth headers based on provider
    if !request.api_key.is_empty() {
        match request.provider.as_str() {
            "anthropic" => {
                req = req
                    .header("x-api-key", &request.api_key)
                    .header("anthropic-version", "2023-06-01");
            }
            _ => {
                // OpenAI-compatible: Bearer token
                req = req.header("Authorization", format!("Bearer {}", request.api_key));
            }
        }
    }

    req = req
        .header("Content-Type", "application/json")
        .json(&request.body);

    let response = req
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status().as_u16();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(LlmResponse { status, body })
}

/// Payload emitted for each streamed token chunk.
#[derive(Clone, Serialize)]
pub struct LlmChunkPayload {
    pub token: String,
}

/// Payload emitted when the stream is done.
#[derive(Clone, Serialize)]
pub struct LlmDonePayload {
    pub full_text: String,
    pub tool_calls: serde_json::Value,
    pub error: Option<String>,
}

/// Streaming LLM chat: reads SSE chunks and emits events to the webview.
#[tauri::command]
pub async fn llm_chat_stream(
    app: tauri::AppHandle,
    request: LlmRequest,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let mut req = client.post(&request.url);

    if !request.api_key.is_empty() {
        match request.provider.as_str() {
            "anthropic" => {
                req = req
                    .header("x-api-key", &request.api_key)
                    .header("anthropic-version", "2023-06-01");
            }
            _ => {
                req = req.header("Authorization", format!("Bearer {}", request.api_key));
            }
        }
    }

    req = req
        .header("Content-Type", "application/json")
        .json(&request.body);

    let response = req
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status().as_u16();

    // If the response is an error, read the full body and emit done with error
    if status >= 400 {
        let body: serde_json::Value = response
            .json()
            .await
            .unwrap_or(serde_json::json!({"error": "Unknown error"}));
        let err_msg = body
            .get("error")
            .and_then(|e| e.get("message").and_then(|m| m.as_str()))
            .or_else(|| body.get("error").and_then(|e| e.as_str()))
            .unwrap_or("Unknown error")
            .to_string();
        let _ = app.emit(
            "llm-done",
            LlmDonePayload {
                full_text: String::new(),
                tool_calls: serde_json::json!([]),
                error: Some(format!("Error ({}): {}", status, err_msg)),
            },
        );
        return Ok(());
    }

    let is_anthropic = request.provider == "anthropic";

    // Read the streaming response as bytes
    let mut stream = response.bytes_stream();
    let mut full_text = String::new();
    let mut tool_calls = Vec::<serde_json::Value>::new();
    let mut buffer = String::new();

    // Anthropic streaming state: track tool_use blocks being built incrementally
    let mut anthropic_tool_index: Option<usize> = None;

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "llm-done",
                    LlmDonePayload {
                        full_text,
                        tool_calls: serde_json::json!(tool_calls),
                        error: Some(format!("Stream error: {}", e)),
                    },
                );
                return Ok(());
            }
        };

        // Append to buffer and process line by line
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete lines from the buffer
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.is_empty() || line == ":" {
                continue;
            }

            // SSE format: "data: {json}" or "data: [DONE]"
            if let Some(data) = line.strip_prefix("data: ") {
                let data = data.trim();

                if data == "[DONE]" {
                    break;
                }

                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if is_anthropic {
                        // Anthropic streaming format
                        let event_type = json.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        match event_type {
                            "content_block_start" => {
                                if let Some(block) = json.get("content_block") {
                                    if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                        let idx = json.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                                        // Start a new tool call entry
                                        while tool_calls.len() <= idx {
                                            tool_calls.push(serde_json::json!(null));
                                        }
                                        tool_calls[idx] = serde_json::json!({
                                            "type": "tool_use",
                                            "id": block.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                                            "name": block.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                                            "input": {}
                                        });
                                        anthropic_tool_index = Some(idx);
                                    }
                                }
                            }
                            "content_block_delta" => {
                                if let Some(delta) = json.get("delta") {
                                    let delta_type = delta.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                    if delta_type == "text_delta" {
                                        if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                            full_text.push_str(text);
                                            let _ = app.emit("llm-chunk", LlmChunkPayload { token: text.to_string() });
                                        }
                                    } else if delta_type == "input_json_delta" {
                                        if let Some(partial) = delta.get("partial_json").and_then(|p| p.as_str()) {
                                            // Accumulate partial JSON for the current tool call
                                            if let Some(idx) = anthropic_tool_index {
                                                if let Some(tc) = tool_calls.get_mut(idx) {
                                                    let existing = tc.get("_partial_json")
                                                        .and_then(|p| p.as_str())
                                                        .unwrap_or("")
                                                        .to_string();
                                                    tc["_partial_json"] = serde_json::json!(format!("{}{}", existing, partial));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            "content_block_stop" => {
                                // Finalize the tool call's input JSON
                                if let Some(idx) = anthropic_tool_index {
                                    if let Some(tc) = tool_calls.get_mut(idx) {
                                        if let Some(partial) = tc.get("_partial_json").and_then(|p| p.as_str()) {
                                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(partial) {
                                                tc["input"] = parsed;
                                            }
                                        }
                                        // Clean up temporary field
                                        if let Some(obj) = tc.as_object_mut() {
                                            obj.remove("_partial_json");
                                        }
                                    }
                                }
                                anthropic_tool_index = None;
                            }
                            "message_stop" => {
                                // Stream is done
                            }
                            _ => {}
                        }
                    } else {
                        // OpenAI-compatible streaming format
                        if let Some(choices) = json.get("choices").and_then(|c| c.as_array()) {
                            if let Some(choice) = choices.first() {
                                if let Some(delta) = choice.get("delta") {
                                    // Text content
                                    if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                        full_text.push_str(content);
                                        let _ = app.emit("llm-chunk", LlmChunkPayload { token: content.to_string() });
                                    }

                                    // Tool calls (streamed incrementally)
                                    if let Some(tcs) = delta.get("tool_calls").and_then(|t| t.as_array()) {
                                        for tc in tcs {
                                            let idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                                            while tool_calls.len() <= idx {
                                                tool_calls.push(serde_json::json!({
                                                    "id": "",
                                                    "type": "function",
                                                    "function": { "name": "", "arguments": "" }
                                                }));
                                            }
                                            // Update id if present
                                            if let Some(id) = tc.get("id").and_then(|i| i.as_str()) {
                                                tool_calls[idx]["id"] = serde_json::json!(id);
                                            }
                                            // Update function name if present
                                            if let Some(func) = tc.get("function") {
                                                if let Some(name) = func.get("name").and_then(|n| n.as_str()) {
                                                    tool_calls[idx]["function"]["name"] = serde_json::json!(name);
                                                }
                                                if let Some(args) = func.get("arguments").and_then(|a| a.as_str()) {
                                                    let existing = tool_calls[idx]["function"]["arguments"]
                                                        .as_str()
                                                        .unwrap_or("")
                                                        .to_string();
                                                    tool_calls[idx]["function"]["arguments"] = serde_json::json!(format!("{}{}", existing, args));
                                                }
                                            }
                                        }
                                    }
                                }

                                // Check for finish_reason
                                if let Some(finish) = choice.get("finish_reason").and_then(|f| f.as_str()) {
                                    if finish == "stop" || finish == "tool_calls" {
                                        // Will be handled after loop
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Anthropic also sends "event: " lines — we can ignore those
        }
    }

    // Filter out null entries from tool_calls
    let tool_calls: Vec<serde_json::Value> = tool_calls.into_iter().filter(|tc| !tc.is_null()).collect();

    let _ = app.emit(
        "llm-done",
        LlmDonePayload {
            full_text,
            tool_calls: serde_json::json!(tool_calls),
            error: None,
        },
    );

    Ok(())
}

/// List available models from an OpenAI-compatible endpoint.
#[tauri::command]
pub async fn llm_list_models(url: String, api_key: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let mut req = client.get(&url);

    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models: {}", e))?;

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse models response: {}", e))?;

    Ok(body)
}
