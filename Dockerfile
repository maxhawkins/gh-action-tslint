FROM node:lts-alpine
MAINTAINER Amir Omidi "amir@aaomidi.com"

RUN yarn install
RUN yarn build

WORKDIR /var/task
COPY dist/index.js .

ENTRYPOINT ["run.sh"]