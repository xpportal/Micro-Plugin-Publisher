import React from 'react';
import fs from 'fs-extra';
import path from 'path';
import * as LocalRenderer from '@getflywheel/local/renderer';
import { IPC_EVENTS } from './constants';
import RepoPluginUploader from './JSONValidatorUploader';

const stylesheetPath = path.resolve(__dirname, '../style.css');

export default async function (context) {
  const { React, hooks } = context;
  const packageJSON = fs.readJsonSync(path.join(__dirname, '../package.json'));
  const addonID = packageJSON.slug;

  console.log('[RENDERER] Initializing JSON Validator & Uploader addon');

  hooks.addContent('stylesheets', () => (
    <link
      rel="stylesheet"
      key="json-validator-uploader-addon-stylesheet"
      href={stylesheetPath}
    />
  ));
  const stylesheetPath = path.resolve(__dirname, '../style.css');

  hooks.addFilter('siteInfoToolsItem', (menu, { routeChildrenProps }) => {
    console.log('[RENDERER] Adding JSON Validator & Uploader to site info tools');
	console.log("Siteeeeeeeee", routeChildrenProps.site);
	const site = routeChildrenProps.site;
    return [
      ...menu,
      {
        menuItem: 'Plugin Publisher',
        path: `/${addonID}`,
        render: ({ match }) => {
          console.log('[RENDERER] MAAAAATCH', match);
          return <RepoPluginUploader
					site={site}
					match={match}
		  		 />;
        },
      },
    ];
  });

  console.log('[RENDERER] JSON Validator & Uploader addon initialized');
}