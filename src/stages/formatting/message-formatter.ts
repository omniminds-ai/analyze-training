import { Message, ProcessedEvent, PipelineStage } from "../../shared/types";

export class MessageFormatter implements PipelineStage<ProcessedEvent[], Message[]> {
    async process(events: ProcessedEvent[]): Promise<Message[]> {
        const messages: Message[] = [];

        for (const event of events) {
            switch (event.type) {
                case "dense_caption":
                    // User sends image and prompt
                    messages.push({
                        role: "user",
                        content: {
                            type: "image",
                            data: event.data.frame!
                        },
                        timestamp: event.timestamp
                    });
                    messages.push({
                        role: "user",
                        content: "Provide a detailed description of the GUI screenshot, including all visible elements, layout, and styling.",
                        timestamp: event.timestamp
                    });
                    // Assistant sends caption
                    messages.push({
                        role: "assistant",
                        content: event.data.text!,
                        timestamp: event.timestamp
                    });
                    break;

                case "state_transition":
                    // User sends both images and prompt
                    messages.push({
                        role: "user",
                        content: {
                            type: "image",
                            data: event.data.beforeFrame!
                        },
                        timestamp: event.timestamp
                    });
                    messages.push({
                        role: "user",
                        content: {
                            type: "image",
                            data: event.data.afterFrame!
                        },
                        timestamp: event.timestamp
                    });
                    messages.push({
                        role: "user",
                        content: "Describe what has changed and what user interaction likely occurred between these screenshots.",
                        timestamp: event.timestamp
                    });
                    // Assistant sends description
                    messages.push({
                        role: "assistant",
                        content: event.data.text!,
                        timestamp: event.timestamp
                    });
                    break;

                case "structured_data":
                    const structuredData = JSON.parse(event.data.text!);
                    // For each query:
                    // 1. User sends image
                    // 2. User sends query with JSON prompt
                    // 3. Assistant sends structured response
                    for (const query of structuredData.queries) {
                        messages.push({
                            role: "user",
                            content: {
                                type: "image",
                                data: event.data.frame!
                            },
                            timestamp: event.timestamp
                        });
                        messages.push({
                            role: "user",
                            content: `Analyze the interface and provide a structured JSON response to: ${query.query}`,
                            timestamp: event.timestamp
                        });
                        messages.push({
                            role: "assistant",
                            content: JSON.stringify(query.response, null, 2),
                            timestamp: event.timestamp
                        });
                    }
                    break;

                case "frame":
                    messages.push({
                        role: "user",
                        content: {
                            type: "image",
                            data: event.data.frame!
                        },
                        timestamp: event.timestamp
                    });
                    break;

                case "quest":
                case "hint":
                    messages.push({
                        role: "user",
                        content: event.data.text || event.data.message || "",
                        timestamp: event.timestamp
                    });
                    break;


                case "reasoning":
                    messages.push({
                        role: "assistant",
                        content: event.data.text || event.data.message || "",
                        timestamp: event.timestamp
                    });
                    break;

                case "mousedrag":
                case "mouseclick":
                case "type":
                case "hotkey":
                    let action = "";
                    switch (event.type) {
                        case "mousedrag":
                            if (event.data.coordinates && event.data.coordinates.length >= 2) {
                                const points = event.data.coordinates.map(c => [c.x, c.y]).flat();
                                action = `drag([${points.join(', ')}])`;
                            }
                            break;
                        case "mouseclick":
                            action = `click(${event.data.x}, ${event.data.y})`;
                            break;
                        case "type":
                            action = `type("${event.data.text}")`;
                            break;
                        case "hotkey":
                            action = `hotkey("${event.data.text}")`;
                            break;
                    }
                    if (action) {
                        messages.push({
                            role: "assistant",
                            content: "```python\n" + action + "\n```",
                            timestamp: event.timestamp
                        });
                    }
                    break;
            }
        }

        return messages;
    }
}
