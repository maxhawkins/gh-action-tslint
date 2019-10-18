FROM node:lts-alpine
MAINTAINER Amir Omidi "amir@aaomidi.com"

RUN mkdir -p /var/task

WORKDIR /var/task
COPY package.json yarn.lock run.sh /var/task/

RUN yarn install

RUN yarn build

COPY dist/index.js /var/task/

ENTRYPOINT ["run.sh"]