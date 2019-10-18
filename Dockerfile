FROM node:lts-alpine
MAINTAINER Amir Omidi "amir@aaomidi.com"

WORKDIR /var/task

COPY . ./
RUN yarn install
RUN yarn build

ENTRYPOINT ["run.sh"]