# Viralmind Data Pipeline

Use the Viralmind data pipeline to gather information about data collected with the Viralmind training gym.

## Usage

The data directory must contain these files for each session id passed to the script.

`session_id.events.json`
`session_id.guac`
`session_id.guac.m4v`

```bash
bun run src/index.ts -o output_dir -s session_id1,session_id2 -d data_directory
```
