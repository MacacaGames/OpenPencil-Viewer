# Public reproduction image provenance

The image-heavy fixture uses images published by The Metropolitan Museum of
Art through its [Open Access programme](https://www.metmuseum.org/hubs/open-access).
The museum makes images of public-domain artworks available under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Every selected artwork's captured public API record has
`isPublicDomain=true`, an empty `rightsAndReproduction`, and names the selected
JPEG in `primaryImage` or `additionalImages`. Images from other records are
excluded. Metadata access and field meanings are described in the museum's
[official Collection API documentation](https://metmuseum.github.io/).

The large fixture's `sources.json` identifies each image's artwork, artist,
credit line, source and metadata URLs, CC0 policy, dimensions and original-byte
hashes. Embedded JPEGs match those hashes and are unmodified. The graph, names,
layout and fixed document metadata are newly created. No confidential design
was read, transformed or used as a template.

The three older small controls contain only procedural pixels. The museum does
not sponsor or endorse this reproduction. OpenPencil's software retains its
upstream MIT license; image provenance is separate from software licensing.
