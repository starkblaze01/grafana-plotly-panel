#!/usr/bin/env bash

tag=$1
tag=${tag:-grafana}

cd "$(dirname "$0")"

rm -rf "${HOME}/tvarit/grafana/${tag}/data/plugins/grafana-plotly-panel"
cp -rpPf dist "${HOME}/tvarit/grafana/${tag}/data/plugins/grafana-plotly-panel"
