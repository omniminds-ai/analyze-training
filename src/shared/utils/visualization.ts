import { ProcessedEvent, Message } from '../types';

function formatTimestamp(timestamp: number): string {
    // If timestamp starts with 0, format as duration
    if (timestamp < 24 * 60 * 60 * 1000) { // Less than a day in milliseconds
        const hours = Math.floor(timestamp / (60 * 60 * 1000));
        const minutes = Math.floor((timestamp % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((timestamp % (60 * 1000)) / 1000);
        const milliseconds = timestamp % 1000;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    }
    // Otherwise use ISO string
    return new Date(timestamp).toISOString();
}

export function visualizeEvents(events: ProcessedEvent[]): string {
    const html = events.map(event => {
        const timestamp = formatTimestamp(event.timestamp);
        let content = '';
        
        switch (event.type) {
            case 'frame':
                content = `<img src="data:image/jpeg;base64,${event.data.frame}" height="200"/>`;
                break;
            case 'keydown':
                content = `keydown(${event.data.keyCode}${event.data.text ? ` "${event.data.text}"` : ''})`;
                break;
            case 'keyup':
                content = `keyup(${event.data.keyCode}${event.data.text ? ` "${event.data.text}"` : ''})`;
                break;
            case 'mousedown':
                content = `mousedown(${event.data.x}, ${event.data.y})`;
                break;
            case 'mouseup':
                content = `mouseup(${event.data.x}, ${event.data.y})`;
                break;
            case 'mousedrag':
                const coords = event.data.coordinates?.map(c => 
                    `[${c.time}ms: (${c.x}, ${c.y})]`
                ).join(', ') || '';
                content = `mousedrag: ${coords}`;
                break;
            default:
                content = JSON.stringify(event.data);
        }
        
        return `
            <div class="event">
                <span class="timestamp">${timestamp}</span>
                <span class="role ${event.type}">${event.type}</span>
                <pre class="content">${content}</pre>
            </div>`;
    }).join('\n');

    return `
        <div class="event-stream">
            <style>
                .event { margin: 5px; padding: 5px; border-left: 3px solid #ccc; }
                .timestamp { color: #666; margin-right: 10px; }
                .role { font-weight: bold; margin-right: 10px; text-transform: uppercase; }
                .role.frame { color: #2c5282; }
                .role.keydown, .role.keyup { color: #e53e3e; }
                .role.mousedown, .role.mouseup, .role.mousedrag { color: #2f855a; }
                .content { margin: 0; white-space: pre-wrap; font-family: monospace; }
            </style>
            ${html}
        </div>`;
}

export function visualizeMessages(messages: Message[]): string {
    return `
        <div class="message-stream">
            <style>
                .message { margin: 5px; padding: 5px; }
                .role { font-weight: bold; margin-right: 10px; text-transform: uppercase; }
                .role.user { color: #e53e3e; }
                .role.assistant { color: #2c5282; }
                .timestamp { color: #666; margin-right: 10px; }
                .content { margin: 0; white-space: pre-wrap; font-family: monospace; }
                .content img { max-height: 200px; }
            </style>
            ${messages.map(msg => {
                const content = typeof msg.content === 'object' && msg.content.type === 'image'
                    ? `<img src="data:image/jpeg;base64,${msg.content.data}" height="200"/>`
                    : `<pre class="content">${msg.content}</pre>`;
                
                return `
                <div class="message">
                    <span class="timestamp">${formatTimestamp(msg.timestamp)}</span>
                    <span class="role ${msg.role}">${msg.role}</span>
                    ${content}
                </div>`;
            }).join('\n')}
        </div>`;
}
