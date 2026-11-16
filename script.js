const dataFile = "data_scopus.csv";
const unknownCountryColor = "#A9A9A9";

const networkElement = document.getElementById("network");
const statusElement = document.getElementById("status");
const detailsElement = document.getElementById("author-details");
const legendElement = document.getElementById("country-legend");
const chargeControl = document.getElementById("charge-strength");
const collisionControl = document.getElementById("collision-radius");
const linkControl = document.getElementById("link-strength");

const chargeValue = document.getElementById("charge-value");
const collisionValue = document.getElementById("collision-value");
const linkValue = document.getElementById("link-value");

function splitAuthors(value) {
    return (value || "")
        .replace(/,\s+(Jr\.|Sr\.|II|III|IV),/g, " $1,")
        .split(/,\s+/)
        .map(function(name) {
            return name.trim();
        })
        .filter(Boolean);
}

function parseAuthorAffiliation(entry) {
    const parts = entry.split(",").map(function(part) {
        return part.trim();
    });

    if (parts.length < 3) {
        return null;
    }

    const country = parts[parts.length - 1];
    const affiliation = parts.slice(2, -1).join(", ");

    if (!country || !affiliation) {
        return null;
    }

    return {
        affiliation: affiliation,
        country: country
    };
}

function buildNetwork(publications) {
    const authorMap = new Map();
    const linkMap = new Map();
    let skippedAuthorRecords = 0;

    publications.forEach(function(publication) {
        const names = splitAuthors(publication.Authors);
        const ids = (publication["Author(s) ID"] || "")
            .split(";")
            .map(function(id) {
                return id.trim();
            });
        const affiliationEntries = (publication["Authors with affiliations"] || "")
            .split(";")
            .map(function(entry) {
                return entry.trim();
            })
            .filter(Boolean);
        const publicationAuthorIds = [];

        for (let i = 0; i < names.length; i++) {
            const id = ids[i];
            const parsedAffiliation = affiliationEntries[i]
                ? parseAuthorAffiliation(affiliationEntries[i])
                : null;

            if (!id || !parsedAffiliation) {
                skippedAuthorRecords++;
                continue;
            }

            if (!authorMap.has(id)) {
                authorMap.set(id, {
                    id: id,
                    name: names[i],
                    affiliation: parsedAffiliation.affiliation,
                    country: parsedAffiliation.country
                });
            }

            publicationAuthorIds.push(id);
        }

        const uniqueAuthorIds = Array.from(new Set(publicationAuthorIds));
        for (let i = 0; i < uniqueAuthorIds.length; i++) {
            for (let j = i + 1; j < uniqueAuthorIds.length; j++) {
                const source = uniqueAuthorIds[i];
                const target = uniqueAuthorIds[j];
                const linkId = [source, target].sort().join("|");
                const existingLink = linkMap.get(linkId);

                if (existingLink) {
                    existingLink.weight++;
                } else {
                    linkMap.set(linkId, {
                        source: source,
                        target: target,
                        weight: 1
                    });
                }
            }
        }
    });

    return {
        nodes: Array.from(authorMap.values()),
        links: Array.from(linkMap.values()),
        skippedAuthorRecords: skippedAuthorRecords
    };
}

function showError(error) {
    console.error("Could not load or render the author network:", error);
    statusElement.textContent =
        "The visualization could not be loaded. Run this page from a web server and confirm data_scopus.csv is beside index.html.";
    statusElement.classList.add("error");
}

function renderNetwork(data) {
    const cleanedPublications = data.filter(function(publication) {
        return publication.Year &&
            publication.Year.trim() &&
            publication.Authors &&
            publication.Authors.trim() &&
            publication["Authors with affiliations"] &&
            publication["Authors with affiliations"].trim();
    });

    const networkData = buildNetwork(cleanedPublications);
    const nodes = networkData.nodes;
    const links = networkData.links;
    const authorsById = new Map(nodes.map(function(author) {
        return [author.id, author];
    }));

    if (nodes.length === 0) {
        throw new Error("No authors with usable affiliation and ID data were found.");
    }

    nodes.forEach(function(author) {
        author.degree = 0;
    });
    links.forEach(function(link) {
        const source = authorsById.get(link.source);
        const target = authorsById.get(link.target);

        if (source) {
            source.degree++;
        }
        if (target) {
            target.degree++;
        }
    });

    const topCountries = Array.from(
        d3.rollup(
            nodes,
            function(countryAuthors) {
                return countryAuthors.length;
            },
            function(author) {
                return author.country;
            }
        ),
        function(entry) {
            return { country: entry[0], count: entry[1] };
        }
    )
        .sort(function(a, b) {
            return b.count - a.count;
        })
        .slice(0, 10);

    const topCountryNames = topCountries.map(function(country) {
        return country.country;
    });
    const countryColor = d3.scaleOrdinal()
        .domain(topCountryNames)
        .range(d3.schemeTableau10);

    nodes.forEach(function(author) {
        author.color = topCountryNames.includes(author.country)
            ? countryColor(author.country)
            : unknownCountryColor;
    });

    const degreeExtent = d3.extent(nodes, function(author) {
        return author.degree;
    });
    const nodeSize = d3.scaleSqrt()
        .domain(degreeExtent[0] === degreeExtent[1]
            ? [0, Math.max(1, degreeExtent[1])]
            : degreeExtent)
        .range([3, 12]);

    const legendItems = topCountries.map(function(country) {
        return {
            country: country.country,
            color: countryColor(country.country)
        };
    });
    legendItems.push({ country: "Other countries", color: unknownCountryColor });

    legendElement.replaceChildren();
    legendItems.forEach(function(item) {
        const legendItem = document.createElement("span");
        legendItem.className = "legend-item";
        const swatch = document.createElement("span");
        swatch.className = "legend-swatch";
        swatch.style.backgroundColor = item.color;
        const label = document.createElement("span");
        label.textContent = item.country;
        legendItem.append(swatch, label);
        legendElement.appendChild(legendItem);
    });

    let width = Math.max(1, networkElement.clientWidth);
    let height = Math.max(1, networkElement.clientHeight);
    const svg = d3.select(networkElement)
        .append("svg")
        .attr("role", "img")
        .attr("aria-label", "Force-directed author co-authorship network")
        .attr("viewBox", "0 0 " + width + " " + height);
    const linkLayer = svg.append("g").attr("class", "links");
    const nodeLayer = svg.append("g").attr("class", "nodes");

    const link = linkLayer.selectAll("line")
        .data(links)
        .join("line")
        .attr("class", "network-link")
        .attr("stroke-width", function(d) {
            return Math.min(1 + Math.sqrt(d.weight), 4);
        });

    const node = nodeLayer.selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("class", "network-node")
        .attr("r", function(d) {
            return nodeSize(d.degree);
        })
        .attr("fill", function(d) {
            return d.color;
        })
        .attr("aria-label", function(d) {
            return d.name + ", " + d.affiliation + ", " + d.country;
        })
        .on("mouseenter", function(event, author) {
            const matchingIds = new Set(nodes
                .filter(function(candidate) {
                    return candidate.affiliation === author.affiliation;
                })
                .map(function(candidate) {
                    return candidate.id;
                }));

            node.classed("is-dimmed", function(candidate) {
                return !matchingIds.has(candidate.id);
            });
            link.classed("is-dimmed", function(connection) {
                return !matchingIds.has(connection.source.id) ||
                    !matchingIds.has(connection.target.id);
            });
        })
        .on("mouseleave", function() {
            node.classed("is-dimmed", false);
            link.classed("is-dimmed", false);
        })
        .on("click", function(event, author) {
            event.stopPropagation();
            detailsElement.hidden = false;
            document.getElementById("detail-name").textContent = author.name;
            document.getElementById("detail-affiliation").textContent =
                author.affiliation || "Not provided";
            document.getElementById("detail-country").textContent =
                author.country || "Not provided";
            document.getElementById("detail-degree").textContent =
                String(author.degree);
            document.getElementById("detail-id").textContent = author.id;
        });

    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links)
            .id(function(d) {
                return d.id;
            })
            .distance(function(d) {
                return 20 + Math.min(d.weight, 10) * 3;
            })
            .strength(Number(linkControl.value)))
        .force("charge", d3.forceManyBody()
            .strength(Number(chargeControl.value))
            .distanceMax(Math.min(width, height) * 0.6))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("x", d3.forceX(width / 2).strength(0.08))
        .force("y", d3.forceY(height / 2).strength(0.08))
        .force("collide", d3.forceCollide()
            .radius(function(d) {
                return nodeSize(d.degree) * Number(collisionControl.value);
            })
            .strength(0.9));

    simulation.on("tick", function() {
        nodes.forEach(function(author) {
            const radius = nodeSize(author.degree);
            const minX = radius;
            const maxX = width - radius;
            const minY = radius;
            const maxY = height - radius;

            if (author.x < minX) {
                author.x = minX;
                author.vx = Math.max(0, author.vx);
            } else if (author.x > maxX) {
                author.x = maxX;
                author.vx = Math.min(0, author.vx);
            }
            if (author.y < minY) {
                author.y = minY;
                author.vy = Math.max(0, author.vy);
            } else if (author.y > maxY) {
                author.y = maxY;
                author.vy = Math.min(0, author.vy);
            }
        });

        link
            .attr("x1", function(d) { return d.source.x; })
            .attr("y1", function(d) { return d.source.y; })
            .attr("x2", function(d) { return d.target.x; })
            .attr("y2", function(d) { return d.target.y; });
        node
            .attr("cx", function(d) { return d.x; })
            .attr("cy", function(d) { return d.y; });
    });

    function updateControlLabels() {
        chargeValue.textContent = chargeControl.value;
        collisionValue.textContent = Number(collisionControl.value).toFixed(1);
        linkValue.textContent = Number(linkControl.value).toFixed(2);
    }

    chargeControl.addEventListener("input", function() {
        simulation.force("charge").strength(Number(chargeControl.value));
        simulation.alpha(0.5).restart();
        updateControlLabels();
    });

    collisionControl.addEventListener("input", function() {
        simulation.force("collide")
            .radius(function(d) {
                return nodeSize(d.degree) * Number(collisionControl.value);
            });
        simulation.alpha(0.5).restart();
        updateControlLabels();
    });

    linkControl.addEventListener("input", function() {
        simulation.force("link").strength(Number(linkControl.value));
        simulation.alpha(0.5).restart();
        updateControlLabels();
    });

    svg.on("click", function() {
        detailsElement.hidden = true;
    });

    let resizeTimer;
    window.addEventListener("resize", function() {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function() {
            width = Math.max(1, networkElement.clientWidth);
            height = Math.max(1, networkElement.clientHeight);
            svg.attr("viewBox", "0 0 " + width + " " + height);
            simulation.force("center", d3.forceCenter(width / 2, height / 2));
            simulation.force("x", d3.forceX(width / 2).strength(0.08));
            simulation.force("y", d3.forceY(height / 2).strength(0.08));
            simulation.force("charge").distanceMax(Math.min(width, height) * 0.6);
            simulation.alpha(0.25).restart();
        }, 120);
    });

    updateControlLabels();
    statusElement.textContent =
        cleanedPublications.length.toLocaleString() + " publications · " +
        nodes.length.toLocaleString() + " authors · " +
        links.length.toLocaleString() + " co-author connections";
    if (networkData.skippedAuthorRecords > 0) {
        console.info(
            "Skipped author records without a matching ID or usable affiliation:",
            networkData.skippedAuthorRecords
        );
    }
}

document.getElementById("close-details").addEventListener("click", function() {
    detailsElement.hidden = true;
});

d3.csv(dataFile)
    .then(renderNetwork)
    .catch(showError);
