FROM node:lts-alpine
MAINTAINER Amir Omidi "amir@aaomidi.com"

WORKDIR /var/task

COPY . ./
RUN yarn install
RUN yarn build
RUN chmod +x run.sh

ENTRYPOINT ["/var/task/run.sh"]