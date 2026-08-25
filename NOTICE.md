# Third-party notices

openGym — Copyright (C) 2026 Duarte Santos.
openGym's own code is licensed under the **GNU AGPL v3.0** (see [LICENSE](LICENSE)).

## App store exception

As an additional permission under section 7 of the AGPL v3.0, the copyright holder permits
distribution of the openGym mobile application through app store platforms (such as the
Apple App Store and Google Play) whose terms of service would otherwise be incompatible
with the AGPL, provided the corresponding source code remains available under the AGPL at
the project repository. This permission applies to the distribution channel only and does
not otherwise limit the license.

## Optional AI provider

The Coach can call the OpenAI Responses API when an instance owner supplies an
`OPENAI_API_KEY`. No provider SDK, credentials or generated responses are bundled in this
repository. Without a key, the application uses its deterministic local coach.

## Body diagram geometry

The compact body diagram in this adaptation is original inline SVG geometry and does not
copy the optional MuscleMap path dataset used by the upstream project.

## Exercise data & media

The exercise names, instructions (English in `frontend/src/lib/exercises-data.js`, other
languages in `frontend/src/instr/`, regenerated via `scripts/build-instructions.mjs`), images
and animations (fetched into `media/` at build time) come from
[**hasaneyldrm/exercises-dataset**](https://github.com/hasaneyldrm/exercises-dataset)
and are **not** covered by openGym's AGPL license — they remain under that dataset's own terms.
The media files are not distributed in this repository; they are downloaded from the upstream
source on first run. If you redistribute openGym with the media included, review the upstream
license first.
