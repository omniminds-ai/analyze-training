# Viralmind Data Pipeline

Use the Viralmind data pipeline to gather information about data collected with the Viralmind training gym.

## Input Data Format

The pipeline expects input data in one of these formats:

1. Gym Desktop recordings:
   - `session_id.mp4` - The video recording
   - `session_id.events.jsonl` - Event data in JSONL format
   - `session_id.meta.json` - Optional metadata about the recording

2. Gym Web recordings:
   - `session_id.events.json` - Event data
   - `session_id.guac` - Guacamole recording file
   - `session_id.guac.m4v` - Video recording

## Usage

```bash
bun run src/index.ts -o output_dir -s session_id1,session_id2 -d data_directory
bun run src/index.ts -o output_dir -s 20250211_215443 -d data
```

### Arguments

- `-o, --output`: Directory to save processed output
- `-s, --sessions`: Comma-separated list of session IDs to process
- `-d, --data`: Directory containing the input data files
