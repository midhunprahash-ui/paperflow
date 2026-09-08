# OrbKit source

Runtime and Nimbus (SHDR-21) from
https://github.com/zzzzshawn/orbkit, commit
`35e42484560fd35e8502703ba58fa99541d8c686`.

Installed Nimbus with `bunx shadcn@latest add zzzzshawn/orbkit/shdr-21` in an isolated staging directory, preserving the existing patched runtime and app styles.

Both files use the MIT license included here and served at
`/licenses/orbkit.txt`. No non-commercial shader variants are included.

Local changes: adjust the relative import, add attribution headers, and expose
`maxFps` in the runtime. Frame throttling and adaptive-resolution thresholds
respect this ceiling. Paperflow uses 30 fps and a maximum device pixel ratio of
one. The integration handles document visibility and live reduced-motion changes,
and unmounts the canvas for completed or failed jobs.
