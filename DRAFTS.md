# RAW
## Optimzied Reddit reply processing
We are processing threads, but probably when we process replies we analyze the same replies over and over. Once a thread is fetched:
- We should find & set the latestFetchedReply
- We should set latestProcessedReply
- We should find the optimal method of processing threads & replies
- Goal is to minimize amount of inference API calls

## Cleanup
Technical analysis apps needs to be removed (bebe, ana-liese and collection), their db traces too

## Observability ramp up
- Set up span links to logs properly
- Make sure attributes are sent properly

## Ramp up inference module
Either fix or remove grader

## Organization
Move Dockerfiles from root to apps/config folder

# HIGH


# LOW
