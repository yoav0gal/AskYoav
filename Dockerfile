# This file is for server

ARG UBUNTU_VERSION=22.04

FROM ubuntu:$UBUNTU_VERSION as build

RUN apt-get update && \
    apt-get install -y build-essential git

WORKDIR /app

COPY . .

RUN make

FROM ubuntu:$UBUNTU_VERSION as runtime

COPY --from=build /app .

ENV LC_ALL=C.utf8

EXPOSE 8080

ENTRYPOINT [ "/server" ]

# To build
# docker build -t llama-server .
# TO run
# docker run -v C:\Users\yoavg\VCProjects\llama.cpp\models\:/models -dp 9999:8080 llama-server -m models/lama2-7B-chat.bin -c 2048 
#  docker run -v C:\Users\yoavg\VCProjects\llama.cpp\models\:/models -p 8080:8080 llama-server -m models/lama2-7B-chat.bin -c 2048