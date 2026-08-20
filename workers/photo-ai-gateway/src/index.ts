export { PhotoAiCoordinator } from './coordinator';

export default {
  fetch(): Response {
    return new Response(null, { status: 404 });
  },
};
