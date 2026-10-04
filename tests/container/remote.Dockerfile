ARG PORTAL_IMAGE=openpencil-viewer:0.1.0
FROM ${PORTAL_IMAGE}
COPY container-harness.mjs /app/container-harness.mjs
COPY basic.fig /app/tests/fixtures/basic.fig
ENV GPU_ENCODER_MODE=cpu GPU_RENDER_MODE=software FIXTURE_PORT=24682
ENTRYPOINT ["node","/app/container-harness.mjs"]
