Source: https://docs.replit.com/features/data-and-storage/object-storage
Retrieved: 2026-11-13T16:30:48.858Z
Representation: webFetch extracted markdown; compatibility research, not legal-content evidence.

> ## Documentation Index
>
> Fetch the complete documentation index at: [/llms.txt](https://docs.replit.com/llms.txt)
>
> Use this file to discover all available pages before exploring further.

[Skip to main content](https://docs.replit.com/features/data-and-storage/object-storage#content-area)

Assistant

Responses are generated using AI and may contain mistakes.

App Storage is Replit’s built-in object storage that lets your app easily host and save uploads like images, videos, and documents.
Buckets are containers for storing objects such as files. They include access policies to limit what actions users or applications can perform on their contents.

**Object Storage** is now called **App Storage**.

With App Storage, you can build apps like:

- **Photo sharing platforms**: Let builders upload, store, and display images
- **Video streaming services**: Handle video uploads and serve content to viewers
- **Document management systems**: Store and organize builder files with secure access
- **Portfolio sites**: Showcase work with media files that load reliably
- **File backup services**: Provide builders with cloud storage for their important files

Ask **Agent** to add App Storage to your app with details on what types of files your app should handle. Agent will set up the integration, create the necessary buckets, and update your app to upload, store, and retrieve files with advanced features like authentication and access controls.

The App Storage tool lets you share data between the development and production environments of the same Replit App.
Each bucket belongs to one project and cannot be shared across apps.

## [​](https://docs.replit.com/features/data-and-storage/object-storage\#features)  Features

App Storage is powered by Google Cloud Storage (GCS).
This means you receive the benefits of industry-leading uptime,
availability, and security.

App Storage provides the following features for your Replit Apps:

- **Persistent cloud storage**: Store files that remain accessible to your published app and users
- **Scalable file handling**: Handle growing data needs without worrying about storage limits
- **Programmatic access**: Upload, download, and manage files using intuitive APIs
- **Enhanced Agent integration**: Let Agent set up App Storage with advanced configurations, inspect existing setups, and generate complete backend and frontend code with authentication and access controls

Here are a few ways you can use App Storage in your Replit Apps:

- Store builder profile pictures and media uploads
- Serve product images for e-commerce sites
- Handle document uploads for form submissions
- Create file sharing and collaboration features
- Build content management systems with media libraries

**Enhanced Agent Integration**: You can prompt [Replit Agent](https://docs.replit.com/features/agent/overview) to automatically add App Storage to your apps! Agent can now set up object storage, inspect configurations, and generate complete backend and frontend code with advanced features like authentication and access controls. Simply mention “App Storage” or “file storage” in your prompt.Learn more about [Agent integrations](https://docs.replit.com/features/integrations/overview#data-storage--management) and see all available App Storage prompts.

## [​](https://docs.replit.com/features/data-and-storage/object-storage\#usage)  Usage

Your Replit App must authenticate with Google Cloud Storage to access a bucket and its objects.
Use the official Replit App Storage client libraries to automatically authenticate.

You can access the App Storage tool directly in your Project Editor.

How to access the App Storage tool

From the **Tools** tab:

1. Select **Tools** in the pane header.
2. Under **Replit Cloud**, select ![App Storage icon](https://mintcdn.com/replit/rJldsgYVucXB_6kW/images/icons/object-storage-monoochrome-icon.svg?fit=max&auto=format&n=rJldsgYVucXB_6kW&q=85&s=ab89fc1e797b8471d0a9b6c6231a93ae)**App Storage**.

![The Tools tab open in the Project Editor with App Storage selected under Replit Cloud in the Tools sidebar](https://mintcdn.com/replit/L5Cc05qXZ_mJRXUU/images/app-storage/app-storage-tools-sidebar.png?fit=max&auto=format&n=L5Cc05qXZ_mJRXUU&q=85&s=40f4d16761edb5f96400e9b53c9c0f77)

From a new tab:

1. Select **+** in the tab bar.
2. Type “App Storage” in **Search tools** and select it from the results.

To associate a new storage bucket with your Replit App, create a bucket.

How to create a bucket

From the **App Storage** tool:

1. Click on **Create new bucket**.
2. Enter a name for the bucket in the **Name** field and select **Create bucket**.

The App Storage tab should resemble the following screenshot:

![An empty App Storage bucket in the Objects view, with Upload files, Upload folder, Create folder, Search, and Refresh controls above the No objects message](https://mintcdn.com/replit/L5Cc05qXZ_mJRXUU/images/app-storage/app-storage-empty-bucket.png?fit=max&auto=format&n=L5Cc05qXZ_mJRXUU&q=85&s=24b2121e8cc99bbb570c1fa827f0d0f4)

To create additional buckets, open the bucket dropdown menu on the top left of the **App Storage** tab and select **Create new bucket**.

The following sections explain the bucket and object management options in the App Storage tool.

### [​](https://docs.replit.com/features/data-and-storage/object-storage\#select-a-bucket)  Select a bucket

To switch between your project’s storage buckets, select the dropdown menu in the top left corner of the **App Storage** tab.The selected bucket displays a check mark next to its name.

### [​](https://docs.replit.com/features/data-and-storage/object-storage\#access-the-bucket-id)  Access the bucket ID

To view the **Bucket ID**, select the **Settings** view from the dropdown at the top of the **App Storage** tab.
The Bucket ID uniquely identifies the bucket, which your code must reference to perform an operation.If you have multiple buckets, select the correct bucket from the dropdown menu in the top left corner.The following screenshot shows the Bucket ID for the “docs-demo-bucket” bucket:

![The Settings view of the App Storage tool showing the Bucket ID for docs-demo-bucket](https://mintcdn.com/replit/L5Cc05qXZ_mJRXUU/images/app-storage/app-storage-bucket-id.png?fit=max&auto=format&n=L5Cc05qXZ_mJRXUU&q=85&s=08c9aabe40e49d0a6caddb263bb56e4b)

### [​](https://docs.replit.com/features/data-and-storage/object-storage\#upload-or-download-objects)  Upload or download objects

To upload an object to the selected bucket:

1. Navigate to the **Objects** view in the **App Storage** tab.
2. Select ![upload file icon](https://mintcdn.com/replit/X_IP1EeHGm0cA2VA/images/icons/upload-file.svg?fit=max&auto=format&n=X_IP1EeHGm0cA2VA&q=85&s=8fc9609ec9b854c24c1873e0d544317c)**Upload files**, or ![upload folder icon](https://mintcdn.com/replit/X_IP1EeHGm0cA2VA/images/icons/upload-folder.svg?fit=max&auto=format&n=X_IP1EeHGm0cA2VA&q=85&s=e35e5e61344451e0e49ddadfd0948b54)**Upload folder** to upload all files from a folder.
Then, select one or more files to upload from the file dialog.
Alternatively, drag a file or folder into the area that lists the contents of the bucket.

To download an object from the selected bucket:

1. Navigate to the **Objects** view in the **App Storage** tab.
2. Select the ![download icon](https://mintcdn.com/replit/rJldsgYVucXB_6kW/images/icons/download-icon.svg?fit=max&auto=format&n=rJldsgYVucXB_6kW&q=85&s=2d532a1cef651ec0c2f06cff8a349b06) download icon to the right of the file to download it.

### [​](https://docs.replit.com/features/data-and-storage/object-storage\#organize-objects-in-folders)  Organize objects in folders

To create a folder in the selected bucket:

1. Navigate to the **Objects** view in the **App Storage** tab.
2. Select ![create folder icon](https://mintcdn.com/replit/rJldsgYVucXB_6kW/images/icons/create-folder.svg?fit=max&auto=format&n=rJldsgYVucXB_6kW&q=85&s=2c57fa06e09e39c6a127a42d5c858eb8)**Create folder** in the **Objects** view.
3. Enter a name for the folder.

To add objects to a folder in the **Objects** view, drag an object to the destination folder.To move an object to a parent folder, drag it onto that folder’s name in the breadcrumb above the object list.
For example, to move `product_demo.mov` from the `videos` folder to the top level of the bucket, drag it onto **Objects** in the breadcrumb.

### [​](https://docs.replit.com/features/data-and-storage/object-storage\#delete-objects-or-buckets)  Delete objects or buckets

The delete action is irreversible. Make sure to back up any essential data before proceeding.

To delete an object forever:

1. Navigate to the **Objects** view in the **App Storage** tab.
2. Select the ![trash icon](https://mintcdn.com/replit/X_IP1EeHGm0cA2VA/images/icons/trash-icon.svg?fit=max&auto=format&n=X_IP1EeHGm0cA2VA&q=85&s=031a29f126332bebd5b6a74de4f16e40) trash icon
next to the object you want to delete.
3. Confirm the deletion in the confirmation dialog.

To delete a bucket and all the objects it contains:

1. Navigate to the **Settings** view in the **App Storage** tab.
2. Make sure you select the bucket you want to delete in the top left bucket dropdown menu.
3. Select ![trash icon](https://mintcdn.com/replit/X_IP1EeHGm0cA2VA/images/icons/trash-icon.svg?fit=max&auto=format&n=X_IP1EeHGm0cA2VA&q=85&s=031a29f126332bebd5b6a74de4f16e40)**Delete Bucket**.
4. Confirm the deletion in the confirmation dialog.

### [​](https://docs.replit.com/features/data-and-storage/object-storage\#copy-code-snippets)  Copy code snippets

The **Commands** view shows ready-to-use code for common App Storage operations, such as uploading, downloading, listing, and deleting objects.

1. Select the **Commands** view from the dropdown at the top of the **App Storage** tab.
2. Select **JavaScript**, **Python**, or **All other languages**.
3. If the App Storage client package is not installed yet, select **Install package** to add it to your project.
4. Copy the snippet for the operation you need.

### [​](https://docs.replit.com/features/data-and-storage/object-storage\#bucket-access-management)  Bucket access management

Each App Storage bucket is exclusive to the project where you create it.
You cannot attach that bucket to another project, even if both projects belong to the same account.To use App Storage in another project, create a separate bucket in that project’s **App Storage** tool.

### [​](https://docs.replit.com/features/data-and-storage/object-storage\#programmatic-access-to-app-storage)  Programmatic access to App Storage

To access App Storage from your Replit App, use one of the following libraries:

- Replit App Storage SDK, available for JavaScript and Python
- [Google Cloud Storage client library](https://cloud.google.com/storage/docs/reference/libraries)

For instructions on how to use the client libraries, see the following resources:

- [JavaScript App Storage SDK](https://docs.replit.com/features/sdks/object-storage-javascript-sdk/): Client reference for the JavaScript SDK
- [Python App Storage SDK](https://docs.replit.com/features/sdks/object-storage-python-sdk/): Client reference for the Python SDK
- [Google Cloud Python SDK example app](https://replit.com/@matt/GCS-Python-Uploads?v=1): Remix this app to manage objects using the Google Cloud Python SDK

## [​](https://docs.replit.com/features/data-and-storage/object-storage\#access-and-security)  Access and security

### [​](https://docs.replit.com/features/data-and-storage/object-storage\#buckets-are-private)  Buckets are private

App Storage buckets are always private, so the App Storage tool has no privacy setting. Replit creates every bucket with Google Cloud Storage [public access prevention](https://cloud.google.com/storage/docs/public-access-prevention) enforced. This blocks anonymous reads and rejects any grant to `allUsers` or `allAuthenticatedUsers`.

Your app controls who can reach your files. Anyone with a signed URL can use it until it expires, and any public route that returns stored files exposes them. Only issue signed URLs and serve files to users your app has authorized.

### [​](https://docs.replit.com/features/data-and-storage/object-storage\#bucket-permissions-and-settings)  Bucket permissions and settings

Your app can upload, download, list, and delete objects in its own buckets. It can’t read or change bucket settings, so calls like `storage.buckets.get` or `storage.buckets.getIamPolicy` return `403 Forbidden`. This is expected: these permissions aren’t available to apps.App Storage doesn’t support lifecycle rules, object versioning, or retention policies. To clean up temporary files, use a [Scheduled deployment](https://docs.replit.com/features/publishing/deployment-types#scheduled) that deletes objects older than a set age.

## [​](https://docs.replit.com/features/data-and-storage/object-storage\#billing-and-resource-usage)  Billing and resource usage

To monitor your App Storage usage, open [Usage](https://replit.com/settings/usage).To learn more about App Storage pricing, see [App Storage Billing](https://docs.replit.com/billing/object-storage-billing).

