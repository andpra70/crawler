#!/bin/bash

git add .
git commit -a -m "update"
git push

docker compose up --build -d
