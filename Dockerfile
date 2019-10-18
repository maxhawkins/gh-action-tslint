FROM node:lts-alpine
MAINTAINER Amir Omidi "amir@aaomidi.com"

WORKDIR /var/task

COPY . ./
RUN yarn install
RUN yarn build

COPY dist/index.js .

ENTRYPOINT ["run.sh"]